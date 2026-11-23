import 'package:dio/dio.dart';

import '../core/api/api_client.dart';
import '../core/json.dart';
import '../core/widgets/paged_list.dart';
import '../models/catalog.dart';
import '../models/customer.dart';

/// Public catalogue + customer endpoints. Money-moving POSTs are sent with `idempotent: true`.
class CustomerRepository {
  CustomerRepository(this.api);
  final ApiClient api;

  List<T> _list<T>(ApiResponse r, T Function(Json) f) => r.list.map(asJson).map(f).toList();

  // ── catalogue ──
  Future<MenuWeek> menu({String? week, String? date}) async =>
      MenuWeek.fromJson((await api.get('/menu', query: {'week': week, 'date': date, 'locale': api.locale})).map);

  Future<BoxDetail> box(String slug) async => BoxDetail.fromJson((await api.get('/boxes/$slug', query: {'locale': api.locale})).map);

  Future<List<Plan>> plans() async => _list(await api.get('/plans', query: {'locale': api.locale}), Plan.fromJson);

  Future<PlanDetail> plan(String slug) async => PlanDetail.fromJson((await api.get('/plans/$slug', query: {'locale': api.locale})).map);

  Future<CoverageCheck> coverageFor(Address a) async => CoverageCheck.fromJson(
        (await api.get('/coverage', query: {'area': a.area, 'ward': a.ward, 'municipality': a.municipality, 'city': a.city, 'lat': a.lat, 'lng': a.lng})).map,
      );

  Future<CoverageSearch> coverageSearch(String q) async => CoverageSearch.fromJson((await api.get('/coverage', query: {'q': q})).map);

  // ── profile ──
  Future<Profile> profile() async => Profile.fromJson((await api.get('/profile')).map);

  Future<Profile> updateProfile(Json changes) async => Profile.fromJson(asJson((await api.patch('/profile', body: changes)).map['profile']));

  Future<void> updatePreferences(FoodPreferences p) => api.patch('/profile/preferences', body: p.toJson());

  Future<NotificationPrefs> notificationPrefs() async => NotificationPrefs.fromJson((await api.get('/profile/notification-preferences')).map);

  Future<void> saveNotificationPrefs(List<NotificationPref> prefs) =>
      api.put('/profile/notification-preferences', body: {'preferences': prefs.map((p) => p.toJson()).toList()});

  // ── addresses ──
  Future<List<Address>> addresses() async => _list(await api.get('/addresses'), Address.fromJson);

  /// Returns (address, covered).
  Future<(Address, bool)> saveAddress(Json input, {String? id}) async {
    final r = id == null ? await api.post('/addresses', body: input) : await api.patch('/addresses/$id', body: input);
    return (Address.fromJson(asJson(r.map['address'])), r.map['covered'] == true);
  }

  Future<void> deleteAddress(String id) => api.delete('/addresses/$id');

  Future<void> makeDefaultAddress(String id) => api.post('/addresses/$id/default');

  // ── cart / orders ──
  Future<CartQuote> quote(List<CartLine> lines, {String? addressId, String? coupon}) async => CartQuote.fromJson(
        (await api.post('/cart/quote', body: {'lines': lines.map((l) => l.toJson()).toList(), 'addressId': addressId, 'couponCode': coupon})).map,
      );

  Future<PurchaseResult> placeOrder({required List<CartLine> lines, required String addressId, required String method, String? slotId, String? coupon, String? notes}) async =>
      PurchaseResult.fromJson(
        (await api.post(
          '/orders',
          idempotent: true,
          body: {
            'lines': lines.map((l) => l.toJson()).toList(),
            'addressId': addressId,
            'method': method,
            'slotId': slotId,
            'couponCode': coupon,
            'notes': notes,
          },
        ))
            .map,
      );

  Future<CursorPage<OrderSummary>> orders({String scope = 'all', String? cursor}) async =>
      CursorPage.from(await api.get('/orders', query: {'scope': scope, 'cursor': cursor, 'limit': 20}), OrderSummary.fromJson);

  Future<OrderDetail> order(String id) async => OrderDetail.fromJson((await api.get('/orders/$id')).map);

  Future<OrderTimeline> timeline(String id) async => OrderTimeline.fromJson((await api.get('/orders/$id/timeline')).map);

  Future<String> cancelOrder(String id, String? reason) async =>
      asJson((await api.post('/orders/$id/cancel', idempotent: true, body: {if (reason != null && reason.isNotEmpty) 'reason': reason})).map).str('message');

  Future<String> skip(String id) async => (await api.post('/orders/$id/skip', idempotent: true)).map['message']?.toString() ?? '';

  Future<String> unskip(String id) async => (await api.post('/orders/$id/unskip')).map['message']?.toString() ?? '';

  Future<List<SwapOption>> swapOptions(String id) async =>
      asJsonList((await api.get('/orders/$id/swap-options')).map['options']).map(SwapOption.fromJson).toList();

  Future<SwapResult> swap(String id, String boxId, {String? method}) async =>
      SwapResult.fromJson((await api.post('/orders/$id/swap', idempotent: true, body: {'boxId': boxId, 'method': method})).map);

  Future<void> feedback(String id, {required int rating, String? comment, bool? onTime}) =>
      api.post('/orders/$id/feedback', body: {'rating': rating, 'comment': comment, 'onTime': onTime});

  // ── payments ──
  Future<CursorPage<PaymentListItem>> payments({String? cursor}) async =>
      CursorPage.from(await api.get('/payments', query: {'cursor': cursor, 'limit': 20}), PaymentListItem.fromJson);

  Future<PaymentDetail> payment(String id) async => PaymentDetail.fromJson((await api.get('/payments/$id')).map);

  Future<PaymentStart> startPayment(String id) async => PaymentStart.fromJson((await api.post('/payments/$id/start')).map);

  Future<String> switchMethod(String id, String method) async =>
      asJson((await api.post('/payments/$id/method', idempotent: true, body: {'method': method})).map).str('next', 'PAY');

  Future<void> uploadProof(String id, {required String filePath, required String fileName, required int fileLength, required String reference}) => api.postMultipart(
        '/payments/$id/proof',
        buildForm: () async => FormData.fromMap({'reference': reference, 'proof': await MultipartFile.fromFile(filePath, filename: fileName)}),
        fingerprintFields: {'reference': reference, 'file': '$fileName:$fileLength'},
      );

  // ── plans ──
  Future<PlanQuote> planQuote(Json input) async => PlanQuote.fromJson((await api.post('/subscriptions/quote', body: input)).map);

  Future<PurchaseResult> subscribe(Json input) async => PurchaseResult.fromJson((await api.post('/subscriptions', idempotent: true, body: input)).map);

  Future<List<SubscriptionSummary>> subscriptions() async => _list(await api.get('/subscriptions'), SubscriptionSummary.fromJson);

  Future<SubscriptionDetail> subscription(String id) async => SubscriptionDetail.fromJson((await api.get('/subscriptions/$id')).map);

  Future<String> pause(String id, {String? from, String? reason}) async =>
      asJson((await api.post('/subscriptions/$id/pause', body: {'from': from, 'reason': reason})).map).str('message');

  Future<String> resume(String id) async => asJson((await api.post('/subscriptions/$id/resume')).map).str('message');

  Future<String> cancelPlan(String id, String reason) async =>
      asJson((await api.post('/subscriptions/$id/cancel', idempotent: true, body: {'reason': reason})).map).str('message');

  Future<String> changePlanAddress(String id, String addressId) async =>
      asJson((await api.put('/subscriptions/$id/address', body: {'addressId': addressId})).map).str('message');

  Future<RenewalQuote> renewalQuote(String id, {int? weeks}) async =>
      RenewalQuote.fromJson((await api.get('/subscriptions/$id/renewal-quote', query: {'weeks': weeks})).map);

  Future<PurchaseResult> renew(String id, {required String method, int? weeks, String? slotId}) async =>
      PurchaseResult.fromJson((await api.post('/subscriptions/$id/renew', idempotent: true, body: {'method': method, 'weeks': weeks, 'slotId': slotId})).map);

  Future<Json> extraMealQuote(String id, String date, String boxId) async => (await api.post('/subscriptions/$id/meals/quote', body: {'date': date, 'boxId': boxId})).map;

  Future<PurchaseResult> addMeal(String id, String date, String boxId, String method) async =>
      PurchaseResult.fromJson((await api.post('/subscriptions/$id/meals', idempotent: true, body: {'date': date, 'boxId': boxId, 'method': method})).map);

  // ── wallet ──
  Future<Wallet> wallet() async => Wallet.fromJson((await api.get('/wallet')).map);

  Future<CursorPage<LedgerEntry>> ledger({String? cursor}) async =>
      CursorPage.from(await api.get('/wallet/ledger', query: {'cursor': cursor, 'limit': 20}), LedgerEntry.fromJson);

  Future<PurchaseResult> topup(int amount, String method) async =>
      PurchaseResult.fromJson((await api.post('/wallet/topups', idempotent: true, body: {'amount': amount, 'method': method})).map);

  // ── notifications, referrals, support, privacy ──
  Future<CursorPage<AppNotification>> notifications({String? cursor}) async =>
      CursorPage.from(await api.get('/notifications', query: {'cursor': cursor, 'limit': 20}), AppNotification.fromJson);

  Future<void> markRead({String? id}) => api.post('/notifications/read', body: {if (id != null) 'id': id});

  Future<Referrals> referrals() async => Referrals.fromJson((await api.get('/referrals')).map);

  Future<String> claimReferral(String code) async => asJson((await api.post('/referrals/claim', body: {'code': code.trim()})).map).str('message');

  Future<List<TicketSummary>> tickets() async => _list(await api.get('/support/tickets'), TicketSummary.fromJson);

  Future<String> openTicket({required String subject, required String body, String category = 'GENERAL', String? orderId}) async =>
      asJson((await api.post('/support/tickets', body: {'subject': subject, 'body': body, 'category': category, 'orderId': orderId})).map).str('id');

  Future<TicketDetail> ticket(String id) async => TicketDetail.fromJson((await api.get('/support/tickets/$id')).map);

  Future<void> replyTicket(String id, String body) => api.post('/support/tickets/$id/messages', body: {'body': body});

  Future<Json> privacyExport() async => (await api.get('/privacy/export')).map;

  Future<List<PrivacyRequest>> privacyRequests() async => _list(await api.get('/privacy/requests'), PrivacyRequest.fromJson);

  Future<String> requestDeletion(String? note) async =>
      asJson((await api.post('/privacy/deletion-request', body: {'confirm': 'DELETE', 'note': note})).map).str('message');
}
