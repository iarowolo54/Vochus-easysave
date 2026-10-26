import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math';
import 'package:android_intent_plus/android_intent.dart';
import 'package:device_info_plus/device_info_plus.dart';
import 'package:esc_pos_utils_plus/esc_pos_utils_plus.dart';
import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:local_auth/local_auth.dart';
import 'package:permission_handler/permission_handler.dart';
import 'package:print_bluetooth_thermal/print_bluetooth_thermal.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:webview_flutter/webview_flutter.dart';
import 'package:webview_flutter_android/webview_flutter_android.dart';

const String kHomeUrl = 'https://easysave.vochusglobalservices.co.uk/login';
const Color kBrandGreen = Color(0xFF0E4D24);
const String kPrinterMacKey = 'vochus_printer_mac';
const String kPrinterNameKey = 'vochus_printer_name';
const String kBioTokenKey = 'vochus_bio_token';
const String kBioIdentifierKey = 'vochus_bio_identifier';
const Duration kIdleTimeout = Duration(minutes: 5);

const _secure = FlutterSecureStorage(
  aOptions: AndroidOptions(encryptedSharedPreferences: true),
);

Future<Map<String, String>> _readDeviceMeta() async {
  final out = <String, String>{};
  try {
    final info = DeviceInfoPlugin();
    if (Platform.isAndroid) {
      final a = await info.androidInfo;
      out['platform'] = 'android';
      out['model'] = a.model;
      out['manufacturer'] = a.manufacturer;
      out['osVersion'] = 'Android ${a.version.release} (SDK ${a.version.sdkInt})';
    } else if (Platform.isIOS) {
      final i = await info.iosInfo;
      out['platform'] = 'ios';
      out['model'] = i.utsname.machine;
      out['manufacturer'] = 'Apple';
      out['osVersion'] = '${i.systemName} ${i.systemVersion}';
    }
  } catch (_) {}
  return out;
}

Future<String> _getOrCreateDeviceId() async {
  final prefs = await SharedPreferences.getInstance();
  // 1) Existing UUID (from older installs) wins — preserves bound-device state
  final legacy = prefs.getString('vochus_device_id');
  if (legacy != null && legacy.isNotEmpty) return legacy;

  // 2) Prefer a hardware-stable ID that survives uninstalls
  String? stable;
  try {
    final info = DeviceInfoPlugin();
    if (Platform.isAndroid) {
      final a = await info.androidInfo;
      if (a.id.isNotEmpty) stable = 'a-${a.id}';
    } else if (Platform.isIOS) {
      final i = await info.iosInfo;
      final v = i.identifierForVendor;
      if (v != null && v.isNotEmpty) stable = 'i-$v';
    }
  } catch (_) {}

  if (stable != null) {
    await prefs.setString('vochus_device_id', stable);
    return stable;
  }

  // 3) Fall back to random UUID
  final rnd = Random.secure();
  final bytes = List<int>.generate(16, (_) => rnd.nextInt(256));
  final id = bytes.map((b) => b.toRadixString(16).padLeft(2, '0')).join();
  await prefs.setString('vochus_device_id', id);
  return id;
}

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  SystemChrome.setSystemUIOverlayStyle(
    const SystemUiOverlayStyle(
      statusBarColor: kBrandGreen,
      statusBarIconBrightness: Brightness.light,
    ),
  );
  runApp(const EasySaveAgentApp());
}

class EasySaveAgentApp extends StatelessWidget {
  const EasySaveAgentApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Vochus Easy Save Agent',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(seedColor: kBrandGreen),
        useMaterial3: true,
      ),
      home: const WebViewPage(),
    );
  }
}

class WebViewPage extends StatefulWidget {
  const WebViewPage({super.key});

  @override
  State<WebViewPage> createState() => _WebViewPageState();
}

class _WebViewPageState extends State<WebViewPage> with WidgetsBindingObserver {
  late final WebViewController _controller;
  bool _loading = true;
  int _progress = 0;
  String _deviceId = '';
  Map<String, String> _deviceMeta = const {};
  String? _bioToken;
  String? _bioIdentifier;
  Timer? _idleTimer;
  DateTime? _backgroundedAt;
  bool _hasError = false;
  int _retryCount = 0;
  String _lastUrl = kHomeUrl;

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    super.didChangeAppLifecycleState(state);
    if (state == AppLifecycleState.paused || state == AppLifecycleState.hidden) {
      _backgroundedAt = DateTime.now();
      _idleTimer?.cancel();
    } else if (state == AppLifecycleState.resumed) {
      final bg = _backgroundedAt;
      _backgroundedAt = null;
      if (bg != null && DateTime.now().difference(bg) >= kIdleTimeout) {
        _handleIdle();
        return;
      }
      _resetIdle();
    }
  }

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _controller = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setBackgroundColor(Colors.white)
      ..addJavaScriptChannel('VochusPrinter',
          onMessageReceived: (msg) => _handlePrintRequest(msg.message))
      ..addJavaScriptChannel('VochusBiometric',
          onMessageReceived: (msg) => _handleBiometricEnroll(msg.message))
      ..addJavaScriptChannel('VochusTriggerBiometric',
          onMessageReceived: (_) => _handleBiometricTrigger())
      ..setNavigationDelegate(
        NavigationDelegate(
          onProgress: (p) => setState(() => _progress = p),
          onPageStarted: (url) async {
            _lastUrl = url;
            setState(() { _loading = true; _hasError = false; });
            await _injectFlags();
          },
          onPageFinished: (_) async {
            setState(() => _loading = false);
            await _injectFlags();
            Future.delayed(const Duration(milliseconds: 500), _injectFlags);
            Future.delayed(const Duration(milliseconds: 1500), _injectFlags);
          },
          onWebResourceError: (err) => _handleWebError(err),
          onHttpError: (err) {
            if (err.response?.statusCode != null && err.response!.statusCode >= 500) {
              _handleWebError(null);
            }
          },
          onUrlChange: (change) {
            if (change.url != null) setState(() => _lastUrl = change.url!);
          },
          onNavigationRequest: (req) {
            if (req.url.endsWith('.apk') || req.url.contains('/downloads/')) {
              AndroidIntent(
                action: 'action_view',
                data: req.url,
              ).launch();
              return NavigationDecision.prevent;
            }
            return NavigationDecision.navigate;
          },
        ),
      );
    // Enable <input type="file"> on Android WebView
    if (_controller.platform is AndroidWebViewController) {
      final android = _controller.platform as AndroidWebViewController;
      android.setOnShowFileSelector(_onShowFileSelector);
      android.setOnPlatformPermissionRequest((request) async {
        final needsCamera = request.types.contains(WebViewPermissionResourceType.camera);
        final needsMic = request.types.contains(WebViewPermissionResourceType.microphone);
        if (needsCamera) {
          final s = await Permission.camera.request();
          if (!s.isGranted) { await request.deny(); return; }
        }
        if (needsMic) {
          final s = await Permission.microphone.request();
          if (!s.isGranted) { await request.deny(); return; }
        }
        await request.grant();
      });
    }
    _bootstrap();
  }

  Future<List<String>> _onShowFileSelector(FileSelectorParams params) async {
    try {
      final accepts = params.acceptTypes;
      final imagesOnly = accepts.isNotEmpty && accepts.every((t) => t.startsWith('image/'));
      final result = await FilePicker.platform.pickFiles(
        allowMultiple: params.mode == FileSelectorMode.openMultiple,
        type: imagesOnly ? FileType.image : FileType.any,
      );
      if (result == null) return [];
      return result.files
          .where((f) => f.path != null)
          .map((f) => Uri.file(f.path!).toString())
          .toList();
    } catch (e) {
      _toast('Could not open file picker: $e');
      return [];
    }
  }

  Future<void> _bootstrap() async {
    _deviceId = await _getOrCreateDeviceId();
    _deviceMeta = await _readDeviceMeta();
    _bioToken = await _secure.read(key: kBioTokenKey);
    _bioIdentifier = await _secure.read(key: kBioIdentifierKey);
    // Biometric no longer auto-triggers on launch. The login page shows a
    // fingerprint icon (when enrolled) that calls VochusTriggerBiometric.
    _controller.loadRequest(Uri.parse(kHomeUrl));
  }

  Future<bool> _promptBiometric() async {
    final auth = LocalAuthentication();
    try {
      final supported = await auth.isDeviceSupported();
      if (!supported) {
        _toast('This device does not support biometric authentication');
        return false;
      }
      final canCheck = await auth.canCheckBiometrics;
      if (!canCheck) {
        _toast('No biometric enrolled on this device — add one in Settings');
        return false;
      }
      final available = await auth.getAvailableBiometrics();
      if (available.isEmpty) {
        _toast('No fingerprint/face enrolled — enroll one in device Settings');
        return false;
      }
      return await auth.authenticate(
        localizedReason: 'Unlock Vochus Easy Save Agent',
        options: const AuthenticationOptions(stickyAuth: true, biometricOnly: false),
      );
    } catch (e) {
      _toast('Biometric error: $e');
      return false;
    }
  }

  Future<void> _injectFlags() async {
    final hasBio = _bioToken != null ? "true" : "false";
    final deviceJson = jsonEncode(_deviceMeta);
    await _controller.runJavaScript(
      "window.__vochusApp = 'agent';"
      "window.__vochusDeviceId = '$_deviceId';"
      "window.__vochusDevice = $deviceJson;"
      "window.__vochusCanPrint = true;"
      "window.__vochusCanBiometric = true;"
      "window.__vochusBiometricEnrolled = $hasBio;"
      "try { window.dispatchEvent(new Event('vochus:flags-ready')); } catch(e) {}",
    );
  }

  Future<void> _handleWebError(WebResourceError? err) async {
    if (!mounted) return;
    if (err != null && err.isForMainFrame == false) return;
    if (_retryCount < 1) {
      _retryCount++;
      await Future.delayed(const Duration(milliseconds: 800));
      if (mounted) _controller.reload();
      return;
    }
    setState(() { _hasError = true; _loading = false; });
  }

  Future<void> _reloadPage() async {
    _retryCount = 0;
    setState(() { _hasError = false; _loading = true; });
    try { await _controller.loadRequest(Uri.parse(_lastUrl)); } catch (_) {}
  }

  Future<void> _handleBiometricTrigger() async {
    if (_bioToken == null || _bioIdentifier == null) {
      _toast('Biometric is not enrolled on this device yet');
      return;
    }
    final ok = await _promptBiometric();
    if (!ok) {
      _toast('Biometric sign-in cancelled');
      return;
    }
    final payload = jsonEncode({'identifier': _bioIdentifier, 'token': _bioToken});
    await _controller.runJavaScript(
      "if (typeof window.__vochusPerformBiometricSignin === 'function') { window.__vochusPerformBiometricSignin($payload); }",
    );
  }

  Future<void> _handleBiometricEnroll(String payload) async {
    try {
      final data = jsonDecode(payload) as Map<String, dynamic>;
      final token = data['token'] as String?;
      final identifier = data['identifier'] as String?;
      if (token == null || identifier == null) return;
      await _secure.write(key: kBioTokenKey, value: token);
      await _secure.write(key: kBioIdentifierKey, value: identifier);
      _bioToken = token;
      _bioIdentifier = identifier;
      _toast('Biometric sign-in enabled');
    } catch (e) {
      _toast('Could not enable biometric: $e');
    }
  }

  Future<void> _clearBiometric() async {
    await _secure.delete(key: kBioTokenKey);
    await _secure.delete(key: kBioIdentifierKey);
    _bioToken = null;
    _bioIdentifier = null;
  }

  // -------- Idle timeout --------

  void _resetIdle() {
    _idleTimer?.cancel();
    _idleTimer = Timer(kIdleTimeout, _handleIdle);
  }

  Future<void> _handleIdle() async {
    if (!mounted) return;
    await WebViewCookieManager().clearCookies();
    if (!mounted) return;
    await _controller.loadRequest(Uri.parse(kHomeUrl));
    _toast('Signed out due to inactivity');
  }

  // -------- Printer --------

  Future<void> _handlePrintRequest(String payload) async {
    try {
      final data = jsonDecode(payload) as Map<String, dynamic>;
      await _ensureBluetoothPermissions();
      final ok = await _printReceipt(data);
      if (!ok && mounted) _toast('Printer not connected');
    } catch (e) {
      _toast('Print failed: $e');
    }
  }

  Future<void> _ensureBluetoothPermissions() async {
    await [
      Permission.bluetoothConnect,
      Permission.bluetoothScan,
      Permission.location,
    ].request();
  }

  Future<bool> _printReceipt(Map<String, dynamic> data) async {
    final prefs = await SharedPreferences.getInstance();
    var mac = prefs.getString(kPrinterMacKey);

    if (mac == null || mac.isEmpty) {
      final picked = await _pickPrinter();
      if (picked == null) return false;
      mac = picked.macAdress;
      await prefs.setString(kPrinterMacKey, mac);
      await prefs.setString(kPrinterNameKey, picked.name ?? 'Printer');
    }

    final isOn = await PrintBluetoothThermal.bluetoothEnabled;
    if (!isOn) {
      _toast('Turn on Bluetooth and try again');
      return false;
    }

    final connected = await PrintBluetoothThermal.connectionStatus;
    if (!connected) {
      final result = await PrintBluetoothThermal.connect(macPrinterAddress: mac);
      if (!result) {
        await prefs.remove(kPrinterMacKey);
        await prefs.remove(kPrinterNameKey);
        _toast('Could not connect — pick the printer again');
        return false;
      }
    }

    final bytes = await _buildReceiptBytes(data);
    final sent = await PrintBluetoothThermal.writeBytes(bytes);
    if (sent) _toast('Printed ✓');
    return sent;
  }

  Future<List<int>> _buildReceiptBytes(Map<String, dynamic> d) async {
    final profile = await CapabilityProfile.load();
    final gen = Generator(PaperSize.mm58, profile);
    final List<int> b = [];

    b.addAll(gen.text('VOCHUS EASY SAVE',
        styles: const PosStyles(
            align: PosAlign.center, bold: true, height: PosTextSize.size2, width: PosTextSize.size2)));
    b.addAll(gen.text('Savings Receipt', styles: const PosStyles(align: PosAlign.center)));
    b.addAll(gen.hr());

    void row(String k, String v) => b.addAll(gen.row([
          PosColumn(text: k, width: 5, styles: const PosStyles(bold: true)),
          PosColumn(text: v, width: 7, styles: const PosStyles(align: PosAlign.right)),
        ]));

    row('Date', (d['date'] ?? '').toString());
    row('Ref', (d['ref'] ?? '').toString());
    b.addAll(gen.hr());
    row('Customer', (d['customer'] ?? '').toString());
    if (d['customerId'] != null) row('ID', d['customerId'].toString());
    if (d['phone'] != null) row('Phone', d['phone'].toString());
    if ((d['goal'] ?? '').toString().isNotEmpty) row('Saving for', d['goal'].toString());
    if ((d['maturityDate'] ?? '').toString().isNotEmpty) row('Maturity', d['maturityDate'].toString());
    b.addAll(gen.hr());

    b.addAll(gen.text('AMOUNT', styles: const PosStyles(align: PosAlign.center, bold: true)));
    b.addAll(gen.text('NGN ${d['amount'] ?? '0'}',
        styles: const PosStyles(
            align: PosAlign.center, bold: true, height: PosTextSize.size2, width: PosTextSize.size2)));
    b.addAll(gen.hr());

    if (d['balance'] != null) row('Balance', 'NGN ${d['balance']}');
    if (d['method'] != null) row('Method', d['method'].toString());
    if ((d['agent'] ?? '').toString().isNotEmpty) row('Agent', d['agent'].toString());

    b.addAll(gen.text('Thank you for saving with Vochus.',
        styles: const PosStyles(align: PosAlign.center)));

    final inviteUrl = (d['inviteUrl'] ?? '').toString();
    if (inviteUrl.isNotEmpty) {
      b.addAll(gen.qrcode(inviteUrl, size: QRSize.size6));
      b.addAll(gen.text('Scan to join & save',
          styles: const PosStyles(align: PosAlign.center)));
    }

    b.addAll(gen.cut());
    return b;
  }

  Future<BluetoothInfo?> _pickPrinter() async {
    final isOn = await PrintBluetoothThermal.bluetoothEnabled;
    if (!isOn) {
      _toast('Turn on Bluetooth and pair your printer first');
      return null;
    }
    final list = await PrintBluetoothThermal.pairedBluetooths;
    if (!mounted) return null;
    if (list.isEmpty) {
      if (Platform.isAndroid) {
        const AndroidIntent(action: 'android.settings.BLUETOOTH_SETTINGS').launch();
      } else {
        _toast('No paired printers — pair one in Bluetooth settings');
      }
      return null;
    }
    return showModalBottomSheet<BluetoothInfo>(
      context: context,
      builder: (ctx) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Padding(
              padding: EdgeInsets.all(16),
              child: Text('Pick your printer',
                  style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
            ),
            ...list.map((p) => ListTile(
                  leading: const Icon(Icons.print),
                  title: Text(p.name ?? 'Unknown'),
                  subtitle: Text(p.macAdress),
                  onTap: () => Navigator.pop(ctx, p),
                )),
            const SizedBox(height: 8),
          ],
        ),
      ),
    );
  }

  void _toast(String msg) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(msg), duration: const Duration(seconds: 2)),
    );
  }

  Future<bool> _onWillPop() async {
    if (await _controller.canGoBack()) {
      await _controller.goBack();
      return false;
    }
    return true;
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _idleTimer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    _resetIdle();
    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) async {
        if (didPop) return;
        final allow = await _onWillPop();
        if (!mounted) return;
        if (allow) Navigator.of(context).pop();
      },
      child: Scaffold(
        body: SafeArea(
          child: Listener(
            behavior: HitTestBehavior.translucent,
            onPointerDown: (_) => _resetIdle(),
            child: Stack(
              children: [
                WebViewWidget(controller: _controller),
                if (_loading)
                  LinearProgressIndicator(
                    value: _progress / 100,
                    backgroundColor: Colors.transparent,
                    valueColor: const AlwaysStoppedAnimation(kBrandGreen),
                  ),
                if (_hasError)
                  Container(
                    color: Colors.white,
                    alignment: Alignment.center,
                    padding: const EdgeInsets.all(24),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        const Icon(Icons.wifi_off_rounded, size: 56, color: Colors.black45),
                        const SizedBox(height: 16),
                        const Text('Something went wrong',
                            style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800)),
                        const SizedBox(height: 6),
                        const Text("The page couldn't load. Check your connection and try again.",
                            textAlign: TextAlign.center,
                            style: TextStyle(color: Colors.black54, fontSize: 13)),
                        const SizedBox(height: 20),
                        ElevatedButton.icon(
                          onPressed: _reloadPage,
                          icon: const Icon(Icons.refresh),
                          label: const Text('Try again'),
                          style: ElevatedButton.styleFrom(
                            backgroundColor: kBrandGreen,
                            foregroundColor: Colors.white,
                            padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 12),
                          ),
                        ),
                      ],
                    ),
                  ),
              ],
            ),
          ),
        ),
        floatingActionButton: _lastUrl.contains('/login') ? null : Padding(
          padding: const EdgeInsets.only(bottom: 64),
          child: FloatingActionButton.small(
          backgroundColor: kBrandGreen,
          tooltip: 'Settings',
          onPressed: () async {
            final prefs = await SharedPreferences.getInstance();
            final current = prefs.getString(kPrinterNameKey);
            if (!mounted) return;
            final action = await showModalBottomSheet<String>(
              context: context,
              builder: (ctx) => SafeArea(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Padding(
                      padding: const EdgeInsets.all(16),
                      child: Text(
                          current == null
                              ? 'Printer: none linked'
                              : 'Printer: $current',
                          style: const TextStyle(fontWeight: FontWeight.bold)),
                    ),
                    ListTile(
                      leading: const Icon(Icons.bluetooth_searching),
                      title: const Text('Pick / change printer'),
                      onTap: () => Navigator.pop(ctx, 'pick'),
                    ),
                    if (current != null)
                      ListTile(
                        leading: const Icon(Icons.link_off),
                        title: const Text('Unlink printer'),
                        onTap: () => Navigator.pop(ctx, 'unlink-printer'),
                      ),
                    const Divider(height: 0),
                    Padding(
                      padding: const EdgeInsets.all(16),
                      child: Text(
                          _bioToken == null
                              ? 'Biometric: not enrolled'
                              : 'Biometric: enabled',
                          style: const TextStyle(fontWeight: FontWeight.bold)),
                    ),
                    if (_bioToken != null)
                      ListTile(
                        leading: const Icon(Icons.fingerprint),
                        title: const Text('Disable biometric sign-in'),
                        onTap: () => Navigator.pop(ctx, 'unlink-bio'),
                      ),
                    const SizedBox(height: 8),
                  ],
                ),
              ),
            );
            if (action == 'pick') {
              await _ensureBluetoothPermissions();
              final picked = await _pickPrinter();
              if (picked != null) {
                await prefs.setString(kPrinterMacKey, picked.macAdress);
                await prefs.setString(kPrinterNameKey, picked.name ?? 'Printer');
                _toast('Printer linked: ${picked.name ?? picked.macAdress}');
              }
            } else if (action == 'unlink-printer') {
              await prefs.remove(kPrinterMacKey);
              await prefs.remove(kPrinterNameKey);
              _toast('Printer unlinked');
            } else if (action == 'unlink-bio') {
              await _clearBiometric();
              _toast('Biometric sign-in disabled');
            }
          },
          child: const Icon(Icons.settings, color: Colors.white),
          ),
        ),
      ),
    );
  }
}
