import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../api/api_exception.dart';
import '../l10n.dart';

/// Centered spinner with a label for screen readers.
class LoadingView extends StatelessWidget {
  const LoadingView({super.key});

  @override
  Widget build(BuildContext context) => Center(
        child: Semantics(
          label: context.l10n.loading,
          child: const Padding(padding: EdgeInsets.all(32), child: CircularProgressIndicator()),
        ),
      );
}

/// Friendly error with retry. Offline errors say so; server messages are shown as-is (safe by contract).
class ErrorView extends StatelessWidget {
  const ErrorView({super.key, required this.error, this.onRetry});

  final Object error;
  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final e = error is ApiException ? error as ApiException : null;
    final offline = e?.isOffline ?? false;
    final title = offline ? l.offlineTitle : l.errorTitle;
    final body = offline ? l.offlineBody : (e?.isForbidden ?? false) ? '${e!.message}\n${l.noPermission}' : (e?.message ?? '$error');
    return Center(
      child: SingleChildScrollView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(offline ? Icons.wifi_off_rounded : Icons.error_outline_rounded, size: 48, color: Theme.of(context).colorScheme.primary),
            const SizedBox(height: 12),
            Text(title, style: Theme.of(context).textTheme.titleLarge, textAlign: TextAlign.center),
            const SizedBox(height: 8),
            Text(body, textAlign: TextAlign.center),
            if (onRetry != null) ...[
              const SizedBox(height: 16),
              FilledButton.icon(onPressed: onRetry, icon: const Icon(Icons.refresh), label: Text(l.retry)),
            ],
          ],
        ),
      ),
    );
  }
}

class EmptyView extends StatelessWidget {
  const EmptyView({super.key, this.message, this.icon = Icons.inbox_outlined, this.action});

  final String? message;
  final IconData icon;
  final Widget? action;

  @override
  Widget build(BuildContext context) => Center(
        child: Padding(
          padding: const EdgeInsets.all(32),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(icon, size: 48, color: Theme.of(context).colorScheme.onSurfaceVariant),
              const SizedBox(height: 12),
              Text(message ?? context.l10n.nothingHere, textAlign: TextAlign.center, style: Theme.of(context).textTheme.titleMedium),
              if (action != null) ...[const SizedBox(height: 16), action!],
            ],
          ),
        ),
      );
}

/// Renders an [AsyncValue] with loading / error (retry) / data states. Keeps showing previous data while refreshing.
class AsyncView<T> extends StatelessWidget {
  const AsyncView({super.key, required this.value, required this.data, this.onRetry});

  final AsyncValue<T> value;
  final Widget Function(T data) data;
  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context) {
    return value.when(
      skipLoadingOnRefresh: true,
      skipLoadingOnReload: true,
      data: data,
      loading: () => const LoadingView(),
      error: (e, _) => ErrorView(error: e, onRetry: onRetry),
    );
  }
}

/// A scrollable full-height area (so RefreshIndicator works around a non-list child).
class ScrollFill extends StatelessWidget {
  const ScrollFill({super.key, required this.child});
  final Widget child;

  @override
  Widget build(BuildContext context) => LayoutBuilder(
        builder: (context, c) => SingleChildScrollView(
          physics: const AlwaysScrollableScrollPhysics(),
          child: ConstrainedBox(constraints: BoxConstraints(minHeight: c.maxHeight), child: child),
        ),
      );
}

/// Screen body for a provider: AsyncView + pull-to-refresh that re-fetches the provider.
class ProviderBody<T> extends ConsumerWidget {
  const ProviderBody({super.key, required this.provider, required this.builder});

  final ProviderBase<AsyncValue<T>> provider;
  final Widget Function(BuildContext context, T data) builder;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final value = ref.watch(provider);
    return RefreshIndicator(
      onRefresh: () => refreshProvider(ref, provider),
      child: value.when(
        skipLoadingOnRefresh: true,
        data: (d) => builder(context, d),
        loading: () => const ScrollFill(child: LoadingView()),
        error: (e, _) => ScrollFill(child: ErrorView(error: e, onRetry: () => ref.invalidate(provider))),
      ),
    );
  }
}

/// Invalidate an async provider and wait until it settles (for RefreshIndicator).
Future<void> refreshProvider<T>(WidgetRef ref, ProviderBase<AsyncValue<T>> provider) async {
  ref.invalidate(provider);
  final done = Completer<void>();
  final sub = ref.listenManual<AsyncValue<T>>(provider, (_, next) {
    if (!next.isLoading && !done.isCompleted) done.complete();
  }, fireImmediately: true,);
  try {
    await done.future.timeout(const Duration(seconds: 30));
  } catch (_) {
    // timeout: stop the spinner; the screen shows its own state
  } finally {
    sub.close();
  }
}
