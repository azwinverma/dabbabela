import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/l10n.dart';
import 'customer_providers.dart';

/// Bottom navigation for the customer app (Home, Menu, Plans, Orders, Account).
class CustomerShell extends StatelessWidget {
  const CustomerShell({super.key, required this.shell});

  final StatefulNavigationShell shell;

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    return Scaffold(
      body: shell,
      bottomNavigationBar: NavigationBar(
        selectedIndex: shell.currentIndex,
        onDestinationSelected: (i) => shell.goBranch(i, initialLocation: i == shell.currentIndex),
        destinations: [
          NavigationDestination(icon: const Icon(Icons.home_outlined), selectedIcon: const Icon(Icons.home_rounded), label: l.tabHome),
          NavigationDestination(icon: const Icon(Icons.restaurant_menu_outlined), selectedIcon: const Icon(Icons.restaurant_menu), label: l.tabMenu),
          NavigationDestination(icon: const Icon(Icons.event_repeat_outlined), selectedIcon: const Icon(Icons.event_repeat), label: l.tabPlans),
          NavigationDestination(icon: const Icon(Icons.receipt_long_outlined), selectedIcon: const Icon(Icons.receipt_long), label: l.tabOrders),
          NavigationDestination(icon: const Icon(Icons.person_outline), selectedIcon: const Icon(Icons.person), label: l.tabAccount),
        ],
      ),
    );
  }
}

/// App-bar cart button with a count badge.
class CartButton extends ConsumerWidget {
  const CartButton({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final count = ref.watch(cartProvider).fold<int>(0, (s, e) => s + e.qty);
    return IconButton(
      tooltip: context.l10n.cart,
      onPressed: () => context.push('/c/cart'),
      icon: Badge(isLabelVisible: count > 0, label: Text('$count'), child: const Icon(Icons.shopping_bag_outlined)),
    );
  }
}
