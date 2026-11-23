import '../core/json.dart';
import 'auth.dart';

// ───────────── Rider ─────────────

/// `RiderWindow` — dates the rider app may open (today−14 … today+7, Kathmandu).
class RiderWindow {
  const RiderWindow({required this.from, required this.to, required this.today});
  final String from;
  final String to;
  final String today;

  factory RiderWindow.fromJson(Json j) => RiderWindow(from: j.str('from'), to: j.str('to'), today: j.str('today'));
}

/// GET /rider/days.
class RiderDays {
  const RiderDays({required this.window, this.days = const []});
  final RiderWindow window;
  final List<({String date, int routes})> days;

  factory RiderDays.fromJson(Json j) => RiderDays(
        window: RiderWindow.fromJson(j.obj('window')),
        days: j.objs('days').map((d) => (date: d.str('date'), routes: d.integer('routes'))).toList(),
      );

  int routesOn(String date) => days.where((d) => d.date == date).fold(0, (a, d) => a + d.routes);
}

class RiderRouteSummary {
  const RiderRouteSummary({
    required this.id,
    required this.name,
    required this.date,
    required this.status,
    this.slotLabel,
    this.riderName,
    this.stops = 0,
    this.stopsDone = 0,
    this.cashCollected = 0,
    this.readOnly = false,
  });

  final String id;
  final String name;
  final String date;
  final String status;
  final String? slotLabel;
  final String? riderName;
  final int stops;
  final int stopsDone;
  final int cashCollected;
  final bool readOnly;

  factory RiderRouteSummary.fromJson(Json j) => RiderRouteSummary(
        id: j.str('id'),
        name: j.str('name'),
        date: j.str('date'),
        status: j.str('status'),
        slotLabel: j.strOrNull('slotLabel'),
        riderName: j.strOrNull('riderName'),
        stops: j.integer('stops'),
        stopsDone: j.integer('stopsDone'),
        cashCollected: j.integer('cashCollected'),
        readOnly: j.boolean('readOnly'),
      );
}

/// GET /rider/routes?date=.
class RiderRoutesDay {
  const RiderRoutesDay({required this.date, this.window, this.readOnly = false, this.routes = const []});
  final String date;
  final RiderWindow? window;
  final bool readOnly;
  final List<RiderRouteSummary> routes;

  factory RiderRoutesDay.fromJson(Json j) => RiderRoutesDay(
        date: j.str('date'),
        window: j.objOrNull('window') == null ? null : RiderWindow.fromJson(j.obj('window')),
        readOnly: j.boolean('readOnly'),
        routes: j.list('routes', RiderRouteSummary.fromJson),
      );
}

class StopItem {
  const StopItem({required this.name, this.quantity = 1});
  final String name;
  final int quantity;
  factory StopItem.fromJson(Json j) => StopItem(name: j.str('name'), quantity: j.integer('quantity', 1));
}

/// `RiderStop`. Deliberately has no hand-off code field: the API never sends it to riders and the app never shows
/// one (`code` is the short label code printed on the dabba, not the OTP).
class RiderStop {
  const RiderStop({
    required this.sequence,
    required this.orderId,
    required this.number,
    this.code = '',
    required this.status,
    this.canAct = false,
    this.placeName,
    this.addressLine = '',
    this.area = '',
    this.ward,
    this.landmark,
    this.instructions,
    this.contactName = '',
    this.contactPhone = '',
    this.contactPhoneDisplay = '',
    this.allergenNote,
    this.items = const [],
    this.paymentMethod,
    this.paymentStatus = '',
    this.cashDue = 0,
  });

  final int sequence;
  final String orderId;
  final String number;
  final String code;
  final String status;
  final bool canAct;
  final String? placeName;
  final String addressLine;
  final String area;
  final int? ward;
  final String? landmark;
  final String? instructions;
  final String contactName;
  final String contactPhone;
  final String contactPhoneDisplay;
  final String? allergenNote;
  final List<StopItem> items;
  final String? paymentMethod;
  final String paymentStatus;

  /// Paisa to collect at the door (0 unless an unpaid CASH order).
  final int cashDue;

  factory RiderStop.fromJson(Json j) => RiderStop(
        sequence: j.integer('sequence'),
        orderId: j.str('orderId'),
        number: j.str('number'),
        code: j.str('code'),
        status: j.str('status'),
        canAct: j.boolean('canAct'),
        placeName: j.strOrNull('placeName'),
        addressLine: j.str('addressLine'),
        area: j.str('area'),
        ward: j.intOrNull('ward'),
        landmark: j.strOrNull('landmark'),
        instructions: j.strOrNull('instructions'),
        contactName: j.str('contactName'),
        contactPhone: j.str('contactPhone'),
        contactPhoneDisplay: j.str('contactPhoneDisplay', j.str('contactPhone')),
        allergenNote: j.strOrNull('allergenNote'),
        items: j.list('items', StopItem.fromJson),
        paymentMethod: j.strOrNull('paymentMethod'),
        paymentStatus: j.str('paymentStatus'),
        cashDue: j.integer('cashDue'),
      );

  /// One-line address for maps search: place, line, area, ward, landmark.
  String get addressText => [
        if ((placeName ?? '').isNotEmpty) placeName!,
        if (addressLine.isNotEmpty) addressLine,
        if (area.isNotEmpty) area,
        if (ward != null) 'Ward $ward',
        if ((landmark ?? '').isNotEmpty) landmark!,
      ].join(', ');
}

/// What the deliver form must ask for.
class DeliverRequirements {
  const DeliverRequirements({this.otp = false, this.photo = false});
  final bool otp;
  final bool photo;
  factory DeliverRequirements.fromJson(Json j) => DeliverRequirements(otp: j.boolean('otp'), photo: j.boolean('photo'));
}

/// GET /rider/routes/{id}.
class RiderRouteDetail {
  const RiderRouteDetail({
    required this.id,
    required this.name,
    required this.date,
    required this.status,
    this.slotLabel,
    this.cashCollected = 0,
    this.readOnly = false,
    this.openStops = 0,
    this.requires = const DeliverRequirements(),
    this.failureReasons = const [],
    this.stops = const [],
  });

  final String id;
  final String name;
  final String date;
  final String status;
  final String? slotLabel;
  final int cashCollected;
  final bool readOnly;
  final int openStops;
  final DeliverRequirements requires;
  final List<String> failureReasons;
  final List<RiderStop> stops;

  bool get canFinish => !readOnly && status != 'DONE' && openStops == 0 && stops.isNotEmpty;

  factory RiderRouteDetail.fromJson(Json j) {
    final stops = j.list('stops', RiderStop.fromJson)..sort((a, b) => a.sequence.compareTo(b.sequence));
    return RiderRouteDetail(
      id: j.str('id'),
      name: j.str('name'),
      date: j.str('date'),
      status: j.str('status'),
      slotLabel: j.strOrNull('slotLabel'),
      cashCollected: j.integer('cashCollected'),
      readOnly: j.boolean('readOnly'),
      openStops: j.integer('openStops'),
      requires: DeliverRequirements.fromJson(j.obj('requires')),
      failureReasons: j.strs('failureReasons'),
      stops: stops,
    );
  }
}

// ───────────── Kitchen ─────────────

class KitchenOrderItem {
  const KitchenOrderItem({required this.name, this.quantity = 1, this.diet = '', this.customizations = const []});
  final String name;
  final int quantity;
  final String diet;
  final List<String> customizations;
  factory KitchenOrderItem.fromJson(Json j) => KitchenOrderItem(
        name: j.str('name'),
        quantity: j.integer('quantity', 1),
        diet: j.str('diet'),
        customizations: j.strs('customizations'),
      );
}

/// `KitchenOrder`.
class KitchenOrder {
  const KitchenOrder({
    required this.id,
    required this.number,
    required this.status,
    this.deliveryDate = '',
    this.slotLabel,
    this.area = '',
    this.placeName,
    this.customerName = '',
    this.allergenNote,
    this.allergenContains = const [],
    this.ticketPrinted = false,
    this.lastPackingOk,
    this.lastPackingNote,
    this.items = const [],
  });

  final String id;
  final String number;
  final String status;
  final String deliveryDate;
  final String? slotLabel;
  final String area;
  final String? placeName;
  final String customerName;
  final String? allergenNote;
  final List<String> allergenContains;
  final bool ticketPrinted;
  final bool? lastPackingOk;
  final String? lastPackingNote;
  final List<KitchenOrderItem> items;

  int get meals => items.fold(0, (a, i) => a + i.quantity);
  bool get hasAllergenFlag => allergenContains.isNotEmpty || (allergenNote ?? '').isNotEmpty;

  factory KitchenOrder.fromJson(Json j) {
    final warn = j.obj('allergenWarning');
    final pack = j.objOrNull('lastPackingCheck');
    return KitchenOrder(
      id: j.str('id'),
      number: j.str('number'),
      status: j.str('status'),
      deliveryDate: j.str('deliveryDate'),
      slotLabel: j.strOrNull('slotLabel'),
      area: j.str('area'),
      placeName: j.strOrNull('placeName'),
      customerName: j.str('customerName'),
      allergenNote: j.strOrNull('allergenNote'),
      allergenContains: warn.strs('contains'),
      ticketPrinted: j.boolean('ticketPrinted'),
      lastPackingOk: pack?.boolean('ok'),
      lastPackingNote: pack?.strOrNull('note'),
      items: j.list('items', KitchenOrderItem.fromJson),
    );
  }
}

class ProductionDish {
  const ProductionDish({required this.name, this.station = '', this.portions = 0, this.buffer = 0, this.total = 0});
  final String name;
  final String station;
  final int portions;
  final int buffer;
  final int total;
  factory ProductionDish.fromJson(Json j) => ProductionDish(
        name: j.str('name'),
        station: j.str('station'),
        portions: j.integer('portions'),
        buffer: j.integer('buffer'),
        total: j.integer('total'),
      );
}

/// GET /kitchen/production.
class Production {
  const Production({
    this.kitchen,
    required this.date,
    this.orders = 0,
    this.meals = 0,
    this.pendingPayment = 0,
    this.allergenFlagged = 0,
    this.bufferPct = 0,
    this.boxes = const [],
    this.dishes = const [],
    this.diets = const [],
    this.allergens = const [],
    this.orderList = const [],
  });

  final KitchenRef? kitchen;
  final String date;
  final int orders;
  final int meals;
  final int pendingPayment;
  final int allergenFlagged;
  final int bufferPct;
  final List<({String name, int meals})> boxes;
  final List<ProductionDish> dishes;
  final List<({String diet, int meals})> diets;
  final List<({String code, int meals})> allergens;
  final List<KitchenOrder> orderList;

  /// Meals per delivery slot (computed from the orders' slot labels).
  Map<String, int> get mealsBySlot {
    final m = <String, int>{};
    for (final o in orderList) {
      final k = o.slotLabel ?? '—';
      m[k] = (m[k] ?? 0) + o.meals;
    }
    return m;
  }

  factory Production.fromJson(Json j) {
    final s = j.obj('summary');
    return Production(
      kitchen: j.objOrNull('kitchen') == null ? null : KitchenRef.fromJson(j.obj('kitchen')),
      date: j.str('date'),
      orders: s.integer('orders'),
      meals: s.integer('meals'),
      pendingPayment: s.integer('pendingPayment'),
      allergenFlagged: s.integer('allergenFlagged'),
      bufferPct: s.integer('bufferPct'),
      boxes: j.objs('boxes').map((b) => (name: b.str('name'), meals: b.integer('meals'))).toList(),
      dishes: j.list('dishes', ProductionDish.fromJson),
      diets: j.objs('diets').map((d) => (diet: d.str('diet'), meals: d.integer('meals'))).toList(),
      allergens: j.objs('allergens').map((a) => (code: a.str('code'), meals: a.integer('meals'))).toList(),
      orderList: j.list('orders', KitchenOrder.fromJson),
    );
  }
}

/// `StatusResult` (bulk start).
class StatusResult {
  const StatusResult({this.changed = const [], this.rejected = const []});
  final List<String> changed;
  final List<({String id, String reason})> rejected;
  factory StatusResult.fromJson(Json j) => StatusResult(
        changed: j.strs('changed'),
        rejected: j.objs('rejected').map((r) => (id: r.str('id'), reason: r.str('reason'))).toList(),
      );
}

/// `PackResult`.
class PackResult {
  const PackResult({required this.orderId, this.number, this.packed = false, this.reason});
  final String orderId;
  final String? number;
  final bool packed;
  final String? reason;
  factory PackResult.fromJson(Json j) => PackResult(
        orderId: j.str('orderId'),
        number: j.strOrNull('number'),
        packed: j.boolean('packed'),
        reason: j.strOrNull('reason'),
      );
}

class BulkPackResult {
  const BulkPackResult({this.packed = 0, this.results = const []});
  final int packed;
  final List<PackResult> results;
  factory BulkPackResult.fromJson(Json j) =>
      BulkPackResult(packed: j.integer('packed'), results: j.list('results', PackResult.fromJson));
}

/// `Batch`.
class Batch {
  const Batch({
    required this.id,
    required this.dish,
    required this.status,
    this.date = '',
    this.station,
    this.plannedPortions = 0,
    this.bufferPortions = 0,
    this.actualPortions,
    this.wastePortions,
    this.assignedTo,
    this.stockPosted = false,
    this.notes,
  });

  final String id;
  final String dish;
  final String status;
  final String date;
  final String? station;
  final int plannedPortions;
  final int bufferPortions;
  final int? actualPortions;
  final int? wastePortions;
  final String? assignedTo;
  final bool stockPosted;
  final String? notes;

  /// Next forward status, or null when finished.
  String? get nextStatus => switch (status) { 'PLANNED' => 'COOKING', 'COOKING' => 'DONE', _ => null };

  factory Batch.fromJson(Json j) => Batch(
        id: j.str('id'),
        dish: j.str('dish'),
        status: j.str('status'),
        date: j.str('date'),
        station: j.strOrNull('station'),
        plannedPortions: j.integer('plannedPortions'),
        bufferPortions: j.integer('bufferPortions'),
        actualPortions: j.intOrNull('actualPortions'),
        wastePortions: j.intOrNull('wastePortions'),
        assignedTo: j.strOrNull('assignedTo'),
        stockPosted: j.boolean('stockPosted'),
        notes: j.strOrNull('notes'),
      );
}

class Shortage {
  const Shortage({required this.dish, required this.name, this.unit = '', this.type = 'USAGE', this.shortage = 0});
  final String dish;
  final String name;
  final String unit;
  final String type;
  final double shortage;
  factory Shortage.fromJson(Json j) => Shortage(
        dish: j.str('dish'),
        name: j.str('name'),
        unit: j.str('unit'),
        type: j.str('type', 'USAGE'),
        shortage: j.dblOrNull('shortage') ?? 0,
      );
}

/// GET /kitchen/batches.
class BatchDay {
  const BatchDay({required this.date, this.batches = const [], this.shortages = const []});
  final String date;
  final List<Batch> batches;
  final List<Shortage> shortages;
  factory BatchDay.fromJson(Json j) => BatchDay(
        date: j.str('date'),
        batches: j.list('batches', Batch.fromJson),
        shortages: j.list('shortages', Shortage.fromJson),
      );
}

/// `QcCheck`.
class QcCheck {
  const QcCheck({required this.id, required this.type, required this.result, this.value, this.note, this.dish, this.createdAt});
  final String id;
  final String type;
  final String result;
  final String? value;
  final String? note;
  final String? dish;
  final DateTime? createdAt;
  factory QcCheck.fromJson(Json j) => QcCheck(
        id: j.str('id'),
        type: j.str('type'),
        result: j.str('result'),
        value: j.strOrNull('value'),
        note: j.strOrNull('note'),
        dish: j.strOrNull('dish'),
        createdAt: j.date('createdAt'),
      );
}

class StockAlert {
  const StockAlert({required this.type, this.severity = 'info', this.entity = '', this.entityId = '', this.message = ''});
  final String type;
  final String severity;
  final String entity;
  final String entityId;
  final String message;
  factory StockAlert.fromJson(Json j) => StockAlert(
        type: j.str('type'),
        severity: j.str('severity', 'info'),
        entity: j.str('entity'),
        entityId: j.str('entityId'),
        message: j.str('message'),
      );
}

// ───────────── Dispatch ─────────────

class RouteRef {
  const RouteRef({required this.id, required this.name});
  final String id;
  final String name;
  static RouteRef? maybe(Json? j) => j == null ? null : RouteRef(id: j.str('id'), name: j.str('name'));
}

/// `DispatchOrder` (phones masked without customers.pii).
class DispatchOrder {
  const DispatchOrder({
    required this.id,
    required this.number,
    required this.status,
    this.contactName = '',
    this.contactPhone = '',
    this.meals = 0,
    this.paymentMethod,
    this.cashDue = 0,
    this.route,
  });

  final String id;
  final String number;
  final String status;
  final String contactName;
  final String contactPhone;
  final int meals;
  final String? paymentMethod;
  final int cashDue;
  final RouteRef? route;

  factory DispatchOrder.fromJson(Json j) => DispatchOrder(
        id: j.str('id'),
        number: j.str('number'),
        status: j.str('status'),
        contactName: j.str('contactName'),
        contactPhone: j.str('contactPhone'),
        meals: j.integer('meals'),
        paymentMethod: j.strOrNull('paymentMethod'),
        cashDue: j.integer('cashDue'),
        route: RouteRef.maybe(j.objOrNull('route')),
      );
}

class BoardStop {
  const BoardStop({
    required this.key,
    this.placeName,
    this.area = '',
    this.landmark,
    this.company,
    this.instructions,
    this.meals = 0,
    this.cash = 0,
    this.orders = const [],
  });
  final String key;
  final String? placeName;
  final String area;
  final String? landmark;
  final String? company;
  final String? instructions;
  final int meals;
  final int cash;
  final List<DispatchOrder> orders;

  String get title => (placeName ?? '').isNotEmpty ? placeName! : area;

  factory BoardStop.fromJson(Json j) => BoardStop(
        key: j.str('key'),
        placeName: j.strOrNull('placeName'),
        area: j.str('area'),
        landmark: j.strOrNull('landmark'),
        company: j.strOrNull('company'),
        instructions: j.strOrNull('instructions'),
        meals: j.integer('meals'),
        cash: j.integer('cash'),
        orders: j.list('orders', DispatchOrder.fromJson),
      );
}

class BoardGroup {
  const BoardGroup({required this.slot, this.zoneId, this.zone = '', this.stops = const []});
  final String slot;
  final String? zoneId;
  final String zone;
  final List<BoardStop> stops;
  int get meals => stops.fold(0, (a, s) => a + s.meals);
  factory BoardGroup.fromJson(Json j) => BoardGroup(
        slot: j.str('slot'),
        zoneId: j.strOrNull('zoneId'),
        zone: j.str('zone'),
        stops: j.list('stops', BoardStop.fromJson),
      );
}

class RouteStop {
  const RouteStop({required this.sequence, required this.orderId, required this.number, required this.status, this.area = '', this.placeName, this.contactName = '', this.changed = const []});
  final int sequence;
  final String orderId;
  final String number;
  final String status;
  final String area;
  final String? placeName;
  final String contactName;
  final List<String> changed;
  factory RouteStop.fromJson(Json j) => RouteStop(
        sequence: j.integer('sequence'),
        orderId: j.str('orderId'),
        number: j.str('number'),
        status: j.str('status'),
        area: j.str('area'),
        placeName: j.strOrNull('placeName'),
        contactName: j.str('contactName'),
        changed: j.strs('changed'),
      );
}

class Rider {
  const Rider({required this.id, required this.name, this.phone = '', this.vehicle, this.zoneIds = const [], this.available = true});
  final String id;
  final String name;
  final String phone;
  final String? vehicle;
  final List<String> zoneIds;
  final bool available;
  factory Rider.fromJson(Json j) => Rider(
        id: j.str('id'),
        name: j.str('name'),
        phone: j.str('phone'),
        vehicle: j.strOrNull('vehicle'),
        zoneIds: j.strs('zoneIds'),
        available: j.boolean('available', true),
      );
}

class DispatchRoute {
  const DispatchRoute({
    required this.id,
    required this.name,
    required this.status,
    this.slotId,
    this.slotLabel,
    this.zoneId,
    this.riderId,
    this.riderName,
    this.riderPhone,
    this.cashExpected,
    this.cashCollected,
    this.stops = const [],
  });

  final String id;
  final String name;
  final String status;
  final String? slotId;
  final String? slotLabel;
  final String? zoneId;
  final String? riderId;
  final String? riderName;
  final String? riderPhone;
  final int? cashExpected;
  final int? cashCollected;
  final List<RouteStop> stops;

  factory DispatchRoute.fromJson(Json j) {
    final rider = j.objOrNull('rider');
    final cash = j.objOrNull('cash');
    return DispatchRoute(
      id: j.str('id'),
      name: j.str('name'),
      status: j.str('status'),
      slotId: j.strOrNull('slotId'),
      slotLabel: j.strOrNull('slotLabel'),
      zoneId: j.strOrNull('zoneId'),
      riderId: rider?.strOrNull('id'),
      riderName: rider?.strOrNull('name'),
      riderPhone: rider?.strOrNull('phone'),
      cashExpected: cash?.intOrNull('expected'),
      cashCollected: cash?.intOrNull('collected'),
      stops: j.list('stops', RouteStop.fromJson)..sort((a, b) => a.sequence.compareTo(b.sequence)),
    );
  }
}

class IdName {
  const IdName(this.id, this.name);
  final String id;
  final String name;
}

/// GET /dispatch/board.
class DispatchBoard {
  const DispatchBoard({
    this.kitchen,
    required this.date,
    this.orders = 0,
    this.handOffPoints = 0,
    this.unroutedCount = 0,
    this.out = 0,
    this.failed = 0,
    this.changedAfterRouting = 0,
    this.groups = const [],
    this.unrouted = const [],
    this.routes = const [],
    this.riders = const [],
    this.slots = const [],
    this.zones = const [],
  });

  final KitchenRef? kitchen;
  final String date;
  final int orders;
  final int handOffPoints;
  final int unroutedCount;
  final int out;
  final int failed;
  final int changedAfterRouting;
  final List<BoardGroup> groups;
  final List<DispatchOrder> unrouted;
  final List<DispatchRoute> routes;
  final List<Rider> riders;
  final List<IdName> slots;
  final List<IdName> zones;

  factory DispatchBoard.fromJson(Json j) {
    final s = j.obj('summary');
    return DispatchBoard(
      kitchen: j.objOrNull('kitchen') == null ? null : KitchenRef.fromJson(j.obj('kitchen')),
      date: j.str('date'),
      orders: s.integer('orders'),
      handOffPoints: s.integer('handOffPoints'),
      unroutedCount: s.integer('unrouted'),
      out: s.integer('out'),
      failed: s.integer('failed'),
      changedAfterRouting: s.integer('changedAfterRouting'),
      groups: j.list('groups', BoardGroup.fromJson),
      unrouted: j.list('unrouted', DispatchOrder.fromJson),
      routes: j.list('routes', DispatchRoute.fromJson),
      riders: j.list('riders', Rider.fromJson),
      slots: j.objs('slots').map((x) => IdName(x.str('id'), x.str('label'))).toList(),
      zones: j.objs('zones').map((x) => IdName(x.str('id'), x.str('name'))).toList(),
    );
  }
}

/// `FailedDelivery`.
class FailedDelivery {
  const FailedDelivery({
    required this.orderId,
    required this.number,
    this.deliveryDate = '',
    this.contactName = '',
    this.contactPhone = '',
    this.area = '',
    this.placeName,
    this.route,
    this.reason,
    this.failedAt,
  });

  final String orderId;
  final String number;
  final String deliveryDate;
  final String contactName;
  final String contactPhone;
  final String area;
  final String? placeName;
  final RouteRef? route;
  final String? reason;
  final DateTime? failedAt;

  factory FailedDelivery.fromJson(Json j) => FailedDelivery(
        orderId: j.str('orderId'),
        number: j.str('number'),
        deliveryDate: j.str('deliveryDate'),
        contactName: j.str('contactName'),
        contactPhone: j.str('contactPhone'),
        area: j.str('area'),
        placeName: j.strOrNull('placeName'),
        route: RouteRef.maybe(j.objOrNull('route')),
        reason: j.strOrNull('reason'),
        failedAt: j.date('failedAt'),
      );
}

/// Result of POST /dispatch/routes/{id}/start.
class RouteStartResult {
  const RouteStartResult({this.out = 0, this.notPacked = 0, this.rejected = const []});
  final int out;
  final int notPacked;
  final List<({String id, String reason})> rejected;
  factory RouteStartResult.fromJson(Json j) => RouteStartResult(
        out: j.integer('out'),
        notPacked: j.integer('notPacked'),
        rejected: j.objs('rejected').map((r) => (id: r.str('id'), reason: r.str('reason'))).toList(),
      );
}
