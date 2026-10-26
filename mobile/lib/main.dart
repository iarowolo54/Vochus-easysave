import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math';
import 'package:android_intent_plus/android_intent.dart';
import 'package:device_info_plus/device_info_plus.dart';
import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:local_auth/local_auth.dart';
import 'package:permission_handler/permission_handler.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:webview_flutter/webview_flutter.dart';
import 'package:webview_flutter_android/webview_flutter_android.dart';
import 'package:path_provider/path_provider.dart';
import 'package:share_plus/share_plus.dart';

const String kHomeUrl = 'https://easysave.vochusglobalservices.co.uk/customer/login';
const Color kBrandGreen = Color(0xFF0D6B3A);
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
  final legacy = prefs.getString('vochus_device_id');
  if (legacy != null && legacy.isNotEmpty) return legacy;

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
  runApp(const EasySaveApp());
}

class EasySaveApp extends StatelessWidget {
  const EasySaveApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Vochus Easy Save',
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
      ..addJavaScriptChannel('VochusBiometric',
          onMessageReceived: (msg) => _handleBiometricEnroll(msg.message))
      ..addJavaScriptChannel('VochusTriggerBiometric',
          onMessageReceived: (_) => _handleBiometricTrigger())
      ..addJavaScriptChannel('VochusSaveReceipt',
          onMessageReceived: (msg) => _handleSaveReceipt(msg.message))
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
          },
          onWebResourceError: (err) => _handleWebError(err),
          onHttpError: (err) {
            if (err.response?.statusCode != null && err.response!.statusCode >= 500) {
              _handleWebError(null);
            }
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
    } catch (_) {
      return [];
    }
  }

  Future<void> _bootstrap() async {
    _deviceId = await _getOrCreateDeviceId();
    _deviceMeta = await _readDeviceMeta();
    _bioToken = await _secure.read(key: kBioTokenKey);
    _bioIdentifier = await _secure.read(key: kBioIdentifierKey);
    // Biometric no longer auto-triggers. Login page shows a fingerprint icon
    // (when enrolled) that calls VochusTriggerBiometric.
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
        localizedReason: 'Unlock Vochus Easy Save',
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
      "window.__vochusApp = 'customer';"
      "window.__vochusDeviceId = '$_deviceId';"
      "window.__vochusDevice = $deviceJson;"
      "window.__vochusCanBiometric = true;"
      "window.__vochusBiometricEnrolled = $hasBio;"
      "window.__vochusCanSaveReceipt = true;"
      "try { window.dispatchEvent(new Event('vochus:flags-ready')); } catch(e) {}",
    );
  }

  Future<void> _handleWebError(WebResourceError? err) async {
    if (!mounted) return;
    // Only handle main-frame errors.
    if (err != null && err.isForMainFrame == false) return;
    if (_retryCount < 1) {
      // Silent auto-retry once.
      _retryCount++;
      await Future.delayed(const Duration(milliseconds: 800));
      if (mounted) _controller.reload();
      return;
    }
    // Second failure — surface the retry UI.
    setState(() { _hasError = true; _loading = false; });
  }

  Future<void> _reloadPage() async {
    _retryCount = 0;
    setState(() { _hasError = false; _loading = true; });
    try {
      await _controller.loadRequest(Uri.parse(_lastUrl));
    } catch (_) {}
  }

  Future<void> _handleSaveReceipt(String payload) async {
    try {
      final data = jsonDecode(payload) as Map<String, dynamic>;
      final b64 = (data['data'] as String?) ?? '';
      final filename = (data['filename'] as String?) ?? 'receipt.png';
      final commaIdx = b64.indexOf(',');
      final pure = commaIdx >= 0 ? b64.substring(commaIdx + 1) : b64;
      final bytes = base64Decode(pure);
      final dir = await getTemporaryDirectory();
      final file = File('${dir.path}/$filename');
      await file.writeAsBytes(bytes);
      await Share.shareXFiles([XFile(file.path, mimeType: 'image/png')], subject: 'Vochus Receipt');
    } catch (e) {
      _toast('Could not save receipt: $e');
    }
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

  void _toast(String msg) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(msg), duration: const Duration(seconds: 2)),
    );
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _idleTimer?.cancel();
    super.dispose();
  }

  Future<bool> _onWillPop() async {
    if (await _controller.canGoBack()) {
      await _controller.goBack();
      return false;
    }
    return true;
  }

  @override
  Widget build(BuildContext context) {
    _resetIdle();
    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) async {
        if (didPop) return;
        final allow = await _onWillPop();
        if (allow && context.mounted) Navigator.of(context).pop();
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
      ),
    );
  }
}
