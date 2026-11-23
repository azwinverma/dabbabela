import 'package:dabba_bela/core/format/dates.dart';
import 'package:dabba_bela/features/customer/checkout_screens.dart';
import 'package:dabba_bela/features/customer/customer_providers.dart';
import 'package:dabba_bela/features/customer/menu_screens.dart';
import 'package:dabba_bela/models/customer.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'helpers.dart';

Map<String, Object?> _box(String id, String name, int price, {bool veg = true}) => {
      'id': id,
      'slug': id,
      'name': name,
      'price': price,
      'diet': veg ? 'VEG' : 'CHICKEN',
      'isVeg': veg,
      'spice': 1,
      'allergens': <Object>[],
      'items': <Object>[],
      'subs': <Object>[],
    };

void main() {
  setUp(() => KtmDates.now = () => DateTime.utc(2026, 11, 22, 2)); // Mon 23 Nov is tomorrow in Kathmandu
  tearDown(() => KtmDates.now = DateTime.now);

  testWidgets('menu: lists dabbas for the day, sold-out cannot be added, add puts it in the cart', (tester) async {
    final api = TestApi(
      routes({
        'GET /menu': (r) => FakeReply.data({
              'weekStart': '2026-11-22',
              'hasMenu': true,
              'companyMenu': {'companyName': 'Leapfrog'},
              'days': [
                {
                  'date': '2026-11-23',
                  'weekday': 'MON',
                  'orderable': true,
                  'cutoff': '09:30',
                  'items': [
                    {'box': _box('b1', 'Dal Bhat Dabba', 25000), 'isPrimary': true, 'soldOut': false, 'remaining': 3},
                    {'box': _box('b2', 'Chicken Choila Dabba', 32000, veg: false), 'isPrimary': false, 'soldOut': true, 'remaining': 0},
                  ],
                },
                {'date': '2026-11-24', 'weekday': 'TUE', 'orderable': false, 'problem': 'Kitchen holiday', 'cutoff': '09:30', 'items': <Object>[]},
              ],
            }),
      }),
    );
    await tester.pumpWidget(testApp(const MenuScreen(), overrides: api.overrides));
    await tester.pumpAndSettle();

    expect(find.text('Dal Bhat Dabba'), findsOneWidget);
    expect(find.text('Chicken Choila Dabba'), findsOneWidget);
    expect(find.text("Showing your company's lunch menu (Leapfrog)"), findsOneWidget);
    expect(find.text('Rs 250'), findsOneWidget);
    expect(find.text('Only 3 left'), findsOneWidget);
    expect(find.text('Sold out'), findsOneWidget);
    expect(api.adapter.requests.first.query['locale'], 'en');

    final soldOutAdd = tester.widget<FilledButton>(find.byKey(const ValueKey('add-b2-2026-11-23')));
    expect(soldOutAdd.onPressed, isNull);

    await tester.tap(find.byKey(const ValueKey('add-b1-2026-11-23')));
    await tester.pump();
    final container = ProviderScope.containerOf(tester.element(find.byType(MenuScreen)));
    final cart = container.read(cartProvider);
    expect(cart.single.boxId, 'b1');
    expect(cart.single.date, '2026-11-23');
    expect(cart.single.toLine().toJson(), {'kind': 'box', 'id': 'b1', 'date': '2026-11-23', 'qty': 1});

    await tester.tap(find.byKey(const ValueKey('day-2026-11-24')));
    await tester.pumpAndSettle();
    expect(find.text('Kitchen holiday'), findsOneWidget);
  });

  testWidgets('menu: offline shows a friendly retry', (tester) async {
    final api = TestApi((r) => throw connectionError(r));
    await tester.pumpWidget(testApp(const MenuScreen(), overrides: api.overrides));
    await tester.pumpAndSettle();
    expect(find.text("You're offline"), findsOneWidget);
    expect(find.text('Try again'), findsOneWidget);
  });

  testWidgets('checkout quote: per-line problem, coupon error, company share, totals', (tester) async {
    const q = CartQuote(
      ok: false,
      lines: [
        QuoteLine(key: 'k1', id: 'b1', date: '2026-11-23', qty: 2, name: 'Dal Bhat Dabba', unitPrice: 25000),
        QuoteLine(key: 'k2', id: 'b2', date: '2026-11-24', qty: 1, name: 'Choila Dabba', unitPrice: 32000, problem: 'Sold out for this day'),
      ],
      subtotal: 82000,
      deliveryFee: 0,
      companyDiscount: 0,
      couponDiscount: 0,
      total: 82000,
      companyShare: 20000,
      customerShare: 62000,
      companyName: 'Leapfrog',
      couponError: 'Coupon expired',
    );
    await tester.pumpWidget(testApp(const Scaffold(body: SingleChildScrollView(child: QuoteSummary(quote: q)))));
    await tester.pumpAndSettle();
    expect(find.text('Sold out for this day'), findsOneWidget);
    expect(find.text('Coupon expired'), findsOneWidget);
    expect(find.text('Rs 820'), findsNWidgets(2)); // subtotal + total
    expect(find.text('Leapfrog pays'), findsOneWidget);
    expect(find.text('Rs 620'), findsOneWidget);
    expect(find.text('Free'), findsOneWidget);
    expect(find.text('Fix the highlighted items to continue.'), findsOneWidget);
  });

  testWidgets('checkout: quotes on the server, places the order with an Idempotency-Key', (tester) async {
    final api = TestApi(
      routes({
        'GET /addresses': (_) => FakeReply.data([
              {'id': 'a1', 'label': 'Office', 'type': 'OFFICE', 'recipientName': 'Sita', 'phone': '9800000000', 'line1': 'Tower 2', 'area': 'Baneshwor', 'city': 'Kathmandu', 'isDefault': true, 'covered': true},
            ]),
        'GET /settings': (_) => FakeReply.data({'paymentMethods': ['CASH', 'ESEWA'], 'flags': <String, Object>{}}),
        'GET /wallet': (_) => FakeReply.data({'balance': 0, 'walletEnabled': false, 'topup': {'enabled': false}}),
        'GET /coverage': (_) => FakeReply.data({'mode': 'address', 'serviceable': true, 'slots': [{'id': 's1', 'label': '12:00–13:00'}]}),
        'POST /cart/quote': (r) {
          final body = r.json! as Map;
          expect(body['addressId'], 'a1');
          return FakeReply.data({
            'ok': true,
            'lines': [{'key': 'k', 'id': 'b1', 'date': '2026-11-23', 'qty': 1, 'name': 'Dal Bhat Dabba', 'unitPrice': 25000}],
            'subtotal': 25000,
            'deliveryFee': 0,
            'total': 25000,
            'customerShare': 25000,
            'taxInclusive': true,
          });
        },
        'POST /orders': (r) => FakeReply.data({'needsPayment': false, 'next': 'DONE', 'orders': [{'id': 'o1'}], 'payment': {'id': 'p1', 'method': 'CASH', 'status': 'PENDING', 'amount': 25000}}, status: 201),
      }),
    );
    await tester.pumpWidget(
      testApp(
        Consumer(
          builder: (context, ref, _) {
            if (ref.read(cartProvider).isEmpty) {
              Future.microtask(() => ref.read(cartProvider.notifier).add(const CartItem(boxId: 'b1', name: 'Dal Bhat Dabba', date: '2026-11-23', unitPrice: 25000)));
            }
            return const CheckoutScreen();
          },
        ),
        overrides: api.overrides,
      ),
    );
    await tester.pumpAndSettle();
    await tester.pump(const Duration(milliseconds: 100));
    await tester.pumpAndSettle();
    expect(find.text('Office'), findsOneWidget);
    expect(find.text('12:00–13:00'), findsOneWidget);
    await tester.scrollUntilVisible(find.byKey(const Key('place-order')), 200, scrollable: find.byType(Scrollable).first);
    await tester.pumpAndSettle();
    final btn = tester.widget<FilledButton>(find.descendant(of: find.byKey(const Key('place-order')), matching: find.byType(FilledButton)));
    expect(btn.onPressed, isNotNull, reason: api.adapter.requests.map((r) => '${r.method} ${r.path}').join(', '));
    await tester.tap(find.byKey(const Key('place-order')));
    // The button keeps its spinner while the confirmation dialog is open, so pump frames instead of settling.
    for (var i = 0; i < 10; i++) {
      await tester.pump(const Duration(milliseconds: 100));
    }
    final order = api.adapter.requests.firstWhere((r) => r.path == '/orders');
    expect(order.headers['Idempotency-Key'], isNotNull);
    expect((order.json! as Map)['method'], 'CASH');
    expect(find.text('Order placed!'), findsOneWidget);
  });
}
