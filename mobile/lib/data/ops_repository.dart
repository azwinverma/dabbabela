import 'dart:io';

import 'package:dio/dio.dart';

import '../core/api/api_client.dart';
import '../core/json.dart';
import '../models/auth.dart';
import '../models/ops.dart';

/// What a rider sends to mark a stop delivered.
class DeliverInput {
  const DeliverInput({this.otp, this.cash, this.note, this.photoPath});

  /// Customer's hand-off code (digits), typed by the rider — never pre-filled by the app.
  final String? otp;

  /// Cash collected in paisa (unpaid CASH orders; must equal cashDue).
  final int? cash;
  final String? note;
  final String? photoPath;

  Map<String, Object?> toJson() => {
        if (otp != null && otp!.isNotEmpty) 'otp': otp,
        if (cash != null) 'cash': cash,
        if (note != null && note!.isNotEmpty) 'note': note,
      };
}

/// Rider endpoints (`rider.view` / `rider.edit`).
class RiderRepository {
  RiderRepository(this.api);
  final ApiClient api;

  Future<RiderDays> days() async => RiderDays.fromJson((await api.get('/rider/days')).map);

  Future<RiderRoutesDay> routes(String? date) async =>
      RiderRoutesDay.fromJson((await api.get('/rider/routes', query: {'date': date})).map);

  Future<RiderRouteDetail> route(String id) async => RiderRouteDetail.fromJson((await api.get('/rider/routes/$id')).map);

  /// Money-moving (cash): Idempotency-Key per delivery action; a retry with the same input reuses it.
  Future<Json> deliver(String orderId, DeliverInput input) async {
    final path = '/rider/stops/$orderId/deliver';
    final photo = input.photoPath;
    if (photo == null) return (await api.post(path, body: input.toJson(), idempotent: true)).map;
    final file = File(photo);
    final length = await file.length();
    final res = await api.postMultipart(
      path,
      idempotent: true,
      fingerprintFields: {...input.toJson(), 'photoPath': photo, 'photoLength': length},
      buildForm: () async => FormData.fromMap({
        ...input.toJson().map((k, v) => MapEntry(k, '$v')),
        'photo': await MultipartFile.fromFile(photo, filename: photo.split(Platform.pathSeparator).last),
      }),
    );
    return res.map;
  }

  Future<void> fail(String orderId, String reason, {String? detail}) =>
      api.post('/rider/stops/$orderId/fail', body: {'reason': reason, if (detail != null && detail.isNotEmpty) 'detail': detail});

  Future<Json> finish(String routeId) async => (await api.post('/rider/routes/$routeId/finish')).map;
}

/// Kitchen endpoints (`kitchen.view` / `kitchen.edit`, kitchen scope).
class KitchenRepository {
  KitchenRepository(this.api);
  final ApiClient api;

  Future<List<KitchenRef>> kitchens() async =>
      asJsonList((await api.get('/kitchen/kitchens')).data).map(KitchenRef.fromJson).toList();

  Future<Production> production(String? kitchenId, String date) async =>
      Production.fromJson((await api.get('/kitchen/production', query: {'kitchenId': kitchenId, 'date': date})).map);

  Future<StatusResult> start(List<String> orderIds) async =>
      StatusResult.fromJson((await api.post('/kitchen/orders/start', body: {'orderIds': orderIds})).map);

  /// All four packing checks confirmed for each order.
  Future<BulkPackResult> pack(List<String> orderIds, {String? note}) async {
    final orders = [
      for (final id in orderIds)
        {'orderId': id, 'itemsOk': true, 'labelOk': true, 'allergenOk': true, 'sealedOk': true, if (note != null && note.isNotEmpty) 'note': note},
    ];
    return BulkPackResult.fromJson((await api.post('/kitchen/orders/pack', body: {'orders': orders})).map);
  }

  Future<BatchDay> batches(String? kitchenId, String date) async =>
      BatchDay.fromJson((await api.get('/kitchen/batches', query: {'kitchenId': kitchenId, 'date': date})).map);

  Future<Json> planBatches(String kitchenId, String date, {int? bufferPct}) async => (await api.post(
        '/kitchen/batches/plan',
        body: {'kitchenId': kitchenId, 'date': date, if (bufferPct != null) 'bufferPct': bufferPct},
      ))
          .map;

  Future<Json> advanceBatch(String id, String to, {int? actualPortions, int? wastePortions, String? notes}) async => (await api.post(
        '/kitchen/batches/$id/advance',
        body: {
          'to': to,
          if (actualPortions != null) 'actualPortions': actualPortions,
          if (wastePortions != null) 'wastePortions': wastePortions,
          if (notes != null && notes.isNotEmpty) 'notes': notes,
        },
      ))
          .map;

  Future<List<QcCheck>> qc(String? kitchenId, String date) async =>
      (await api.get('/kitchen/qc', query: {'kitchenId': kitchenId, 'date': date})).map.list('checks', QcCheck.fromJson);

  Future<void> logQc({required String kitchenId, required String date, required String type, required String result, String? value, String? note}) =>
      api.post('/kitchen/qc', body: {
        'kitchenId': kitchenId,
        'date': date,
        'type': type,
        'result': result,
        if (value != null && value.isNotEmpty) 'value': value,
        if (note != null && note.isNotEmpty) 'note': note,
      });

  Future<List<StockAlert>> stockAlerts(String? kitchenId) async =>
      (await api.get('/kitchen/stock-alerts', query: {'kitchenId': kitchenId})).map.list('alerts', StockAlert.fromJson);
}

/// Dispatcher endpoints (`dispatch.view` / `dispatch.edit`, kitchen scope).
class DispatchRepository {
  DispatchRepository(this.api);
  final ApiClient api;

  Future<DispatchBoard> board(String? kitchenId, String date) async =>
      DispatchBoard.fromJson((await api.get('/dispatch/board', query: {'kitchenId': kitchenId, 'date': date})).map);

  Future<Json> createRoute({
    required String kitchenId,
    required String date,
    required String name,
    String? slotId,
    String? zoneId,
    String? riderId,
    List<String> orderIds = const [],
  }) async =>
      (await api.post('/dispatch/routes', body: {
        'kitchenId': kitchenId,
        'date': date,
        'name': name,
        'slotId': slotId,
        'zoneId': zoneId,
        'riderId': riderId,
        'orderIds': orderIds,
      }))
          .map;

  Future<void> addOrders(String routeId, List<String> orderIds) => api.post('/dispatch/routes/$routeId/orders', body: {'orderIds': orderIds});

  Future<void> assignRider(String routeId, String? riderId) => api.put('/dispatch/routes/$routeId/rider', body: {'riderId': riderId});

  Future<RouteStartResult> startRoute(String routeId) async =>
      RouteStartResult.fromJson((await api.post('/dispatch/routes/$routeId/start')).map);

  Future<void> completeRoute(String routeId) => api.post('/dispatch/routes/$routeId/complete');

  Future<void> unassign(String orderId) => api.delete('/dispatch/orders/$orderId/assignment');

  Future<Json> autoGroup(String kitchenId, String date) async =>
      (await api.post('/dispatch/auto-group', body: {'kitchenId': kitchenId, 'date': date})).map;

  Future<List<FailedDelivery>> failed(String? kitchenId, String date) async =>
      (await api.get('/dispatch/failed', query: {'kitchenId': kitchenId, 'date': date})).map.list('failed', FailedDelivery.fromJson);

  /// RETRY or CANCEL (CANCEL credits the wallet → idempotent).
  Future<void> resolveFailed(String orderId, String action, String reason) =>
      api.post('/dispatch/failed/$orderId/resolve', body: {'action': action, 'reason': reason}, idempotent: true);
}
