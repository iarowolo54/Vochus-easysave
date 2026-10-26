import 'package:flutter_test/flutter_test.dart';
import 'package:easysave_agent/main.dart';

void main() {
  testWidgets('App boots', (tester) async {
    await tester.pumpWidget(const EasySaveAgentApp());
    expect(find.byType(EasySaveAgentApp), findsOneWidget);
  });
}
