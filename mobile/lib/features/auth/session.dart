import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_exception.dart';
import '../../core/providers.dart';
import '../../data/auth_repository.dart';
import '../../models/auth.dart';

final authRepositoryProvider = Provider<AuthRepository>((ref) => AuthRepository(ref.watch(apiClientProvider)));

enum SessionStatus { loading, signedOut, signedIn, error }

@immutable
class SessionState {
  const SessionState({required this.status, this.me, this.activeApp, this.error});

  final SessionStatus status;
  final Me? me;

  /// The app section the user is in. Null = show the switcher (users with several apps).
  final AppSection? activeApp;

  /// Why /me failed on start-up (offline) — the token is kept so a retry can resume.
  final Object? error;

  bool get signedIn => status == SessionStatus.signedIn && me != null;

  SessionState copyWith({SessionStatus? status, Me? me, AppSection? activeApp, bool clearApp = false, Object? error}) => SessionState(
        status: status ?? this.status,
        me: me ?? this.me,
        activeApp: clearApp ? null : (activeApp ?? this.activeApp),
        error: error,
      );
}

/// Owns the bearer session: token in secure storage, GET /me after sign-in and on start, routing by `apps`,
/// sign-out (device token unregistered), and dropping the session on any 401 UNAUTHENTICATED.
class SessionController extends Notifier<SessionState> {
  StreamSubscription<String>? _pushSub;

  AuthRepository get _repo => ref.read(authRepositoryProvider);

  @override
  SessionState build() {
    ref.read(apiClientProvider).onUnauthenticated = _onUnauthenticated;
    ref.onDispose(() => _pushSub?.cancel());
    Future.microtask(restore);
    return const SessionState(status: SessionStatus.loading);
  }

  /// App start: token present → GET /me.
  Future<void> restore() async {
    final token = await ref.read(tokenStoreProvider).load();
    if (token == null) {
      state = const SessionState(status: SessionStatus.signedOut);
      return;
    }
    state = const SessionState(status: SessionStatus.loading);
    await _loadMe();
  }

  Future<void> _loadMe({AppSection? prefer}) async {
    try {
      final me = await _repo.me();
      await ref.read(localeProvider.notifier).set(me.locale, persist: false);
      state = SessionState(status: SessionStatus.signedIn, me: me, activeApp: _defaultApp(me, prefer ?? state.activeApp));
      unawaited(_registerPush());
    } on ApiException catch (e) {
      if (e.isUnauthenticated) {
        await _clear();
      } else {
        state = SessionState(status: SessionStatus.error, error: e);
      }
    }
  }

  /// Re-read /me (after 2FA enrolment, profile changes, pull-to-refresh).
  Future<void> refreshMe() => _loadMe(prefer: state.activeApp);

  AppSection? _defaultApp(Me me, AppSection? preferred) {
    if (preferred != null && me.apps.contains(preferred)) return preferred;
    final apps = me.appList;
    return apps.length == 1 ? apps.first : null;
  }

  /// Step 1. Returns the result so the UI can show the 2FA step when `twoFactorRequired`.
  Future<SignInResult> signIn(String email, String password) async {
    final r = await _repo.signIn(email, password);
    if (!r.twoFactorRequired && r.token != null) await acceptToken(r.token!);
    return r;
  }

  Future<void> verifyTwoFactor(String challenge, String code, {bool backup = false}) async {
    final r = await _repo.verifyTwoFactor(challenge, code, backup: backup);
    if (r.token == null) throw ApiException(kind: ApiFailureKind.server, code: 'INVALID_CODE', message: 'That code didn’t work.');
    await acceptToken(r.token!);
  }

  /// Store a new token (sign-in, sign-up, OTP, 2FA confirm) and load /me.
  Future<void> acceptToken(String token, {AppSection? prefer}) async {
    await ref.read(tokenStoreProvider).save(token);
    await _loadMe(prefer: prefer);
  }

  void selectApp(AppSection? app) {
    if (app == null) {
      state = state.copyWith(clearApp: true);
    } else if (state.me?.apps.contains(app) ?? false) {
      state = state.copyWith(activeApp: app);
    }
  }

  Future<void> signOut() async {
    final push = ref.read(pushServiceProvider);
    try {
      await _repo.signOut(deviceToken: push.currentToken);
    } catch (_) {
      // Offline / already expired: still sign out locally.
    }
    await _clear();
  }

  void _onUnauthenticated() {
    if (state.status == SessionStatus.signedOut) return;
    unawaited(_clear());
  }

  Future<void> _clear() async {
    await _pushSub?.cancel();
    _pushSub = null;
    await ref.read(tokenStoreProvider).clear();
    await ref.read(idempotencyProvider).clear();
    state = const SessionState(status: SessionStatus.signedOut);
  }

  Future<void> _registerPush() async {
    final push = ref.read(pushServiceProvider);
    try {
      final token = await push.init();
      if (token != null) await _repo.registerDevice(token);
      await _pushSub?.cancel();
      _pushSub = push.tokenRefreshes.listen((t) => _repo.registerDevice(t).catchError((Object _) {}));
    } catch (_) {
      // Push is best-effort.
    }
  }
}

final sessionProvider = NotifierProvider<SessionController, SessionState>(SessionController.new);

/// Convenience: the signed-in user (throws if read while signed out).
final meProvider = Provider<Me?>((ref) => ref.watch(sessionProvider).me);
