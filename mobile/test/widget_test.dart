import 'package:flutter_test/flutter_test.dart';
import 'package:easysave_customer/main.dart';

void main() {
  testWidgets('App boots', (tester) async {
    await tester.pumpWidget(const EasySaveApp());
    expect(find.byType(EasySaveApp), findsOneWidget);
  });
}
