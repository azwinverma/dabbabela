import 'dart:convert';

import 'package:dabba_bela/core/json.dart';
import 'package:dabba_bela/models/ops.dart';
import 'package:flutter_test/flutter_test.dart';

/// Example payloads shaped like the openapi.yaml schemas (RiderRouteDetail, production, DispatchBoard,
/// FailedDelivery) — including unknown extra fields, which clients must ignore.
Json _j(String s) => asJson(jsonDecode(s));

void main() {
  test('RiderRouteDetail parses stops in sequence, requirements, reasons; no hand-off code field', () {
    final r = RiderRouteDetail.fromJson(
      _j('''
{"id":"rt1","name":"Baneshwor lunch","date":"2026-11-24","status":"OUT","slotLabel":"12:00–13:00","cashCollected":25000,
 "readOnly":false,"openStops":1,"requires":{"otp":true,"photo":false},"failureReasons":["Customer not reachable","Other"],
 "futureField":42,
 "stops":[
  {"sequence":2,"orderId":"o2","number":"DB-1002","code":"K7","status":"DELIVERED","canAct":false,"placeName":null,
   "addressLine":"House 4","area":"Baneshwor","ward":10,"landmark":null,"instructions":null,"contactName":"Asha",
   "contactPhone":"9800000002","contactPhoneDisplay":"980-0000002","allergenNote":null,"items":[{"name":"Dal Bhat","quantity":1}],
   "paymentMethod":"ESEWA","paymentStatus":"PAID","cashDue":0},
  {"sequence":1,"orderId":"o1","number":"DB-1001","code":"K3","status":"OUT_FOR_DELIVERY","canAct":true,"placeName":"Leapfrog",
   "addressLine":"Tower 2, 5th floor","area":"Baneshwor","ward":10,"landmark":"Opposite the bank","instructions":"Reception",
   "contactName":"Ram","contactPhone":"9800000001","contactPhoneDisplay":"980-0000001","allergenNote":"No peanuts",
   "items":[{"name":"Chicken Thali","quantity":2}],"paymentMethod":"CASH","paymentStatus":"PENDING","cashDue":45000}
 ]}'''),
    );
    expect(r.stops.map((s) => s.sequence), [1, 2]);
    expect(r.requires.otp, isTrue);
    expect(r.requires.photo, isFalse);
    expect(r.failureReasons.last, 'Other');
    final s = r.stops.first;
    expect(s.cashDue, 45000);
    expect(s.canAct, isTrue);
    expect(s.addressText, 'Leapfrog, Tower 2, 5th floor, Baneshwor, Ward 10, Opposite the bank');
    expect(s.items.single.quantity, 2);
    expect(r.canFinish, isFalse); // a stop is still out
    expect(
      RiderRouteDetail.fromJson(
        _j(
          '{"id":"x","name":"n","date":"d","status":"OUT","openStops":0,"stops":[{"sequence":1,"orderId":"a","number":"n","status":"DELIVERED"}]}',
        ),
      ).canFinish,
      isTrue,
    );
  });

  test('RiderRoutesDay and RiderDays', () {
    final d = RiderRoutesDay.fromJson(
      _j(
        '''
{"date":"2026-11-24","window":{"from":"2026-11-10","to":"2026-12-01","today":"2026-11-24"},"readOnly":false,
 "routes":[{"id":"rt1","name":"A","date":"2026-11-24","status":"PLANNED","slotLabel":null,"riderName":"Bikash","stops":5,"stopsDone":2,"cashCollected":0,"readOnly":false}]}''',
      ),
    );
    expect(d.window!.today, '2026-11-24');
    expect(d.routes.single.stopsDone, 2);
    final days = RiderDays.fromJson(
      _j('{"window":{"from":"a","to":"b","today":"c"},"days":[{"date":"2026-11-24","routes":3}]}'),
    );
    expect(days.routesOn('2026-11-24'), 3);
    expect(days.routesOn('2026-11-25'), 0);
  });

  test('Production: summary, boxes, dishes, orders, meals by slot', () {
    final p = Production.fromJson(
      _j('''
{"kitchen":{"id":"k1","name":"Central","code":"KTM"},"date":"2026-11-24",
 "summary":{"orders":3,"meals":5,"pendingPayment":1,"allergenFlagged":1,"bufferPct":5},
 "boxes":[{"name":"Dal Bhat","meals":3},{"name":"Chicken Thali","meals":2}],
 "dishes":[{"menuItemId":"m1","name":"Dal","station":"Hot","portions":3,"buffer":1,"total":4}],
 "diets":[{"diet":"VEG","meals":3}],"allergens":[{"code":"DAIRY","meals":1}],
 "orders":[
  {"id":"o1","number":"DB-1","status":"CONFIRMED","deliveryDate":"2026-11-24","slotLabel":"12:00","area":"Baneshwor","placeName":null,
   "customerName":"Ram","allergenNote":"No ghee","allergenWarning":{"contains":["DAIRY"],"customerNote":"No ghee"},"ticketPrinted":false,
   "lastPackingCheck":{"ok":false,"note":"Label missing"},"items":[{"name":"Dal Bhat","quantity":2,"diet":"VEG","customizations":[]}]},
  {"id":"o2","number":"DB-2","status":"PREPARING","deliveryDate":"2026-11-24","slotLabel":"12:00","area":"Tinkune","customerName":"Sita",
   "allergenWarning":{"contains":[]},"lastPackingCheck":null,"items":[{"name":"Chicken Thali","quantity":2}]},
  {"id":"o3","number":"DB-3","status":"PACKED","slotLabel":"13:00","area":"Koteshwor","customerName":"Hari","items":[{"name":"Dal Bhat","quantity":1}]}
 ]}'''),
    );
    expect(p.kitchen!.code, 'KTM');
    expect(p.meals, 5);
    expect(p.boxes.first.name, 'Dal Bhat');
    expect(p.dishes.single.total, 4);
    expect(p.orderList.first.hasAllergenFlag, isTrue);
    expect(p.orderList.first.lastPackingOk, isFalse);
    expect(p.orderList[1].lastPackingOk, isNull);
    expect(p.mealsBySlot, {'12:00': 4, '13:00': 1});
  });

  test('Batch next status and pack/status results', () {
    final b = BatchDay.fromJson(
      _j(
        '''
{"date":"2026-11-24","batches":[{"id":"b1","date":"2026-11-24","menuItemId":"m","dish":"Dal","station":null,"status":"PLANNED",
 "plannedPortions":40,"bufferPortions":2,"actualPortions":null,"wastePortions":null,"assignedTo":null,"stockPosted":false,"notes":null}],
 "shortages":[{"batchId":"b1","dish":"Dal","ingredientId":"i","name":"Lentils","unit":"KG","type":"USAGE","shortage":1.5,"at":"2026-11-24T05:00:00.000Z"}]}''',
      ),
    );
    expect(b.batches.single.nextStatus, 'COOKING');
    expect(b.shortages.single.shortage, 1.5);
    final pr = BulkPackResult.fromJson(
      _j(
        '{"packed":1,"results":[{"orderId":"o1","number":"DB-1","packed":true,"reason":null},{"orderId":"o2","number":null,"packed":false,"reason":"Not preparing"}]}',
      ),
    );
    expect(pr.results.where((r) => !r.packed).single.reason, 'Not preparing');
    final sr = StatusResult.fromJson(_j('{"changed":["o1"],"rejected":[{"id":"o9","reason":"Not in your kitchens"}]}'));
    expect(sr.rejected.single.id, 'o9');
  });

  test('DispatchBoard parses summary, groups, unrouted, routes, riders, slots, zones', () {
    final b = DispatchBoard.fromJson(
      _j('''
{"kitchen":{"id":"k1","name":"Central","code":"KTM"},"date":"2026-11-24",
 "summary":{"orders":4,"handOffPoints":3,"unrouted":1,"out":1,"failed":0,"changedAfterRouting":1},
 "groups":[{"slot":"12:00–13:00","zoneId":"z1","zone":"Baneshwor","stops":[{"key":"s1","placeName":"Leapfrog","area":"Baneshwor","landmark":null,
   "company":"Leapfrog","office":null,"instructions":null,"meals":2,"cash":45000,
   "orders":[{"id":"o1","number":"DB-1","status":"PACKED","contactName":"Ram","contactPhone":"98******01","meals":2,"paymentMethod":"CASH","cashDue":45000,"route":{"id":"r1","name":"Route 1"}}]}]}],
 "unrouted":[{"id":"o4","number":"DB-4","status":"CONFIRMED","contactName":"Gita","contactPhone":"98******04","meals":1,"paymentMethod":null,"cashDue":0,"route":null}],
 "routes":[{"id":"r1","name":"Route 1","status":"OUT","slotId":"s1","slotLabel":"12:00–13:00","zoneId":"z1",
   "rider":{"id":"u1","name":"Bikash","phone":"98******11"},"cost":null,"startedAt":"2026-11-24T05:30:00.000Z","completedAt":null,
   "cash":{"expected":45000,"collected":0,"handedIn":null,"variance":null},
   "stops":[{"sequence":2,"orderId":"o2","number":"DB-2","status":"OUT_FOR_DELIVERY","area":"Tinkune","placeName":null,"contactName":"Sita","changed":null},
            {"sequence":1,"orderId":"o1","number":"DB-1","status":"OUT_FOR_DELIVERY","area":"Baneshwor","placeName":"Leapfrog","contactName":"Ram","changed":["address"]}]}],
 "riders":[{"id":"u1","name":"Bikash","phone":"98******11","vehicle":"Scooter","zoneIds":["z1"],"available":false}],
 "slots":[{"id":"s1","label":"12:00–13:00","startTime":"12:00","endTime":"13:00"}],
 "zones":[{"id":"z1","name":"Baneshwor"}],"failed":[]}'''),
    );
    expect(b.unroutedCount, 1);
    expect(b.groups.single.meals, 2);
    expect(b.groups.single.stops.single.orders.single.route!.name, 'Route 1');
    expect(b.unrouted.single.route, isNull);
    final r = b.routes.single;
    expect(r.riderName, 'Bikash');
    expect(r.cashExpected, 45000);
    expect(r.stops.map((s) => s.sequence), [1, 2]);
    expect(r.stops.first.changed, ['address']);
    expect(b.riders.single.available, isFalse);
    expect(b.slots.single.name, '12:00–13:00');
    expect(b.zones.single.name, 'Baneshwor');
  });

  test('FailedDelivery list', () {
    final list = _j(
      '''
{"kitchen":{"id":"k1","name":"Central","code":"KTM"},"date":"2026-11-24","failed":[
 {"orderId":"o5","number":"DB-5","deliveryDate":"2026-11-24","contactName":"Hari","contactPhone":"98******05","area":"Koteshwor",
  "placeName":null,"route":{"id":"r1","name":"Route 1"},"reason":"Customer not reachable","failedAt":"2026-11-24T07:10:00.000Z"}]}''',
    ).list('failed', FailedDelivery.fromJson);
    expect(list.single.reason, 'Customer not reachable');
    expect(list.single.route!.id, 'r1');
    expect(list.single.failedAt, DateTime.utc(2026, 11, 24, 7, 10));
  });

  test('tolerates missing fields', () {
    final s = RiderStop.fromJson(_j('{"orderId":"o1"}'));
    expect(s.cashDue, 0);
    expect(s.items, isEmpty);
    final b = DispatchBoard.fromJson(_j('{}'));
    expect(b.routes, isEmpty);
  });
}
