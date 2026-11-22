import 'package:flutter/material.dart';

import '../api/api_client.dart';
import 'states.dart';

/// One page of a cursor-paginated list (`?limit=&cursor=` → `meta.nextCursor`).
class CursorPage<T> {
  const CursorPage(this.items, this.nextCursor, {this.meta = const {}});
  final List<T> items;
  final String? nextCursor;
  final Map<String, Object?> meta;

  static CursorPage<T> from<T>(ApiResponse res, T Function(Map<String, Object?>) parse) => CursorPage<T>(
        res.list.whereType<Map<Object?, Object?>>().map((m) => parse(m.cast<String, Object?>())).toList(),
        res.nextCursor,
        meta: res.meta,
      );
}

/// Infinite list over a cursor API with pull-to-refresh, loading / empty / error states and "load more".
class PagedList<T> extends StatefulWidget {
  const PagedList({
    super.key,
    required this.fetch,
    required this.itemBuilder,
    this.header,
    this.emptyMessage,
    this.emptyIcon = Icons.inbox_outlined,
    this.onFirstPage,
    this.separated = true,
  });

  final Future<CursorPage<T>> Function(String? cursor) fetch;
  final Widget Function(BuildContext context, T item) itemBuilder;
  final Widget? header;
  final String? emptyMessage;
  final IconData emptyIcon;
  final void Function(CursorPage<T> page)? onFirstPage;
  final bool separated;

  @override
  State<PagedList<T>> createState() => PagedListState<T>();
}

class PagedListState<T> extends State<PagedList<T>> {
  final List<T> _items = [];
  String? _cursor;
  bool _done = false;
  bool _loading = false;
  Object? _error;
  bool _initial = true;

  @override
  void initState() {
    super.initState();
    refresh();
  }

  Future<void> refresh() async {
    setState(() {
      _initial = true;
      _error = null;
    });
    try {
      final page = await widget.fetch(null);
      if (!mounted) return;
      widget.onFirstPage?.call(page);
      setState(() {
        _items
          ..clear()
          ..addAll(page.items);
        _cursor = page.nextCursor;
        _done = page.nextCursor == null;
        _initial = false;
      });
    } catch (e) {
      if (mounted) {
        setState(() {
          _error = e;
          _initial = false;
        });
      }
    }
  }

  Future<void> _more() async {
    if (_loading || _done) return;
    setState(() => _loading = true);
    try {
      final page = await widget.fetch(_cursor);
      if (!mounted) return;
      setState(() {
        _items.addAll(page.items);
        _cursor = page.nextCursor;
        _done = page.nextCursor == null;
      });
    } catch (e) {
      if (mounted) setState(() => _error = e);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    Widget body;
    if (_initial) {
      body = const ScrollFill(child: LoadingView());
    } else if (_items.isEmpty && _error != null) {
      body = ScrollFill(child: ErrorView(error: _error!, onRetry: refresh));
    } else if (_items.isEmpty) {
      body = ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        children: [
          if (widget.header != null) widget.header!,
          EmptyView(message: widget.emptyMessage, icon: widget.emptyIcon),
        ],
      );
    } else {
      final extra = (widget.header != null ? 1 : 0);
      body = NotificationListener<ScrollNotification>(
        onNotification: (n) {
          if (n.metrics.pixels > n.metrics.maxScrollExtent - 300) _more();
          return false;
        },
        child: ListView.builder(
          physics: const AlwaysScrollableScrollPhysics(),
          itemCount: _items.length + extra + 1,
          itemBuilder: (c, i) {
            if (widget.header != null && i == 0) return widget.header!;
            final idx = i - extra;
            if (idx == _items.length) {
              if (_done) return const SizedBox(height: 24);
              if (_error != null) {
                return Padding(
                  padding: const EdgeInsets.all(16),
                  child: Center(child: TextButton(onPressed: _more, child: const Icon(Icons.refresh))),
                );
              }
              return const Padding(padding: EdgeInsets.all(16), child: Center(child: CircularProgressIndicator()));
            }
            final tile = widget.itemBuilder(c, _items[idx]);
            return widget.separated ? Column(children: [tile, const Divider(height: 1)]) : tile;
          },
        ),
      );
    }
    return RefreshIndicator(onRefresh: refresh, child: body);
  }
}
