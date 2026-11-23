import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/providers.dart';
import '../../data/customer_repository.dart';
import '../../models/catalog.dart';
import '../../models/customer.dart';

final customerRepositoryProvider = Provider<CustomerRepository>((ref) => CustomerRepository(ref.watch(apiClientProvider)));

/// Any date in the wanted week (null = this week).
final menuWeekParamProvider = StateProvider<String?>((ref) => null);

final menuProvider = FutureProvider.autoDispose<MenuWeek>((ref) {
  ref.watch(localeProvider);
  return ref.watch(customerRepositoryProvider).menu(week: ref.watch(menuWeekParamProvider));
});

final boxProvider = FutureProvider.autoDispose.family<BoxDetail, String>((ref, slug) {
  ref.watch(localeProvider);
  return ref.watch(customerRepositoryProvider).box(slug);
});

final plansProvider = FutureProvider.autoDispose<List<Plan>>((ref) {
  ref.watch(localeProvider);
  return ref.watch(customerRepositoryProvider).plans();
});

final planDetailProvider = FutureProvider.autoDispose.family<PlanDetail, String>((ref, slug) => ref.watch(customerRepositoryProvider).plan(slug));

final addressesProvider = FutureProvider.autoDispose<List<Address>>((ref) => ref.watch(customerRepositoryProvider).addresses());

final upcomingOrdersProvider = FutureProvider.autoDispose<List<OrderSummary>>(
  (ref) async => (await ref.watch(customerRepositoryProvider).orders(scope: 'upcoming')).items,
);

final orderProvider = FutureProvider.autoDispose.family<OrderDetail, String>((ref, id) => ref.watch(customerRepositoryProvider).order(id));

final timelineProvider = FutureProvider.autoDispose.family<OrderTimeline, String>((ref, id) => ref.watch(customerRepositoryProvider).timeline(id));

final subscriptionsProvider = FutureProvider.autoDispose<List<SubscriptionSummary>>((ref) => ref.watch(customerRepositoryProvider).subscriptions());

final subscriptionProvider = FutureProvider.autoDispose.family<SubscriptionDetail, String>((ref, id) => ref.watch(customerRepositoryProvider).subscription(id));

final walletProvider = FutureProvider.autoDispose<Wallet>((ref) => ref.watch(customerRepositoryProvider).wallet());

final profileProvider = FutureProvider.autoDispose<Profile>((ref) => ref.watch(customerRepositoryProvider).profile());

/// One dabba in the cart (client-side until checkout; the server prices it with /cart/quote).
class CartItem {
  const CartItem({required this.boxId, required this.name, required this.date, required this.unitPrice, this.qty = 1, this.slug});
  final String boxId;
  final String? slug;
  final String name;
  final String date;
  final int unitPrice;
  final int qty;

  String get key => '$boxId@$date';
  CartLine toLine() => CartLine(kind: 'box', id: boxId, date: date, qty: qty);
  CartItem withQty(int q) => CartItem(boxId: boxId, slug: slug, name: name, date: date, unitPrice: unitPrice, qty: q);
}

class CartController extends Notifier<List<CartItem>> {
  @override
  List<CartItem> build() => const [];

  void add(CartItem item) {
    final i = state.indexWhere((e) => e.key == item.key);
    if (i >= 0) {
      setQty(item.key, (state[i].qty + item.qty).clamp(1, 25));
    } else {
      state = [...state, item]..sort((a, b) => a.date.compareTo(b.date));
    }
  }

  void setQty(String key, int qty) {
    if (qty <= 0) {
      remove(key);
      return;
    }
    state = [for (final e in state) e.key == key ? e.withQty(qty.clamp(1, 25)) : e];
  }

  void remove(String key) => state = state.where((e) => e.key != key).toList();

  void clear() => state = const [];

  int get count => state.fold(0, (s, e) => s + e.qty);
}

final cartProvider = NotifierProvider<CartController, List<CartItem>>(CartController.new);
