import '../core/json.dart';

/// Customer-side models matching docs/api/openapi.yaml (Profile, Address, CartQuote, Order*, Payment*, Subscription*,
/// Wallet, Notification, Referrals, Ticket*). All money is integer paisa.

class FoodPreferences {
  const FoodPreferences({this.diet = 'ANY', this.spiceTolerance = 2, this.allergies = const [], this.avoidOnionGarlic = false, this.dietaryNotes});
  final String diet;
  final int spiceTolerance;
  final List<String> allergies;
  final bool avoidOnionGarlic;
  final String? dietaryNotes;

  factory FoodPreferences.fromJson(Json j) => FoodPreferences(
        diet: j.str('diet', 'ANY'),
        spiceTolerance: j.integer('spiceTolerance', 2),
        allergies: j.strs('allergies'),
        avoidOnionGarlic: j.boolean('avoidOnionGarlic'),
        dietaryNotes: j.strOrNull('dietaryNotes'),
      );

  Json toJson() => {
        'diet': diet,
        'spiceTolerance': spiceTolerance,
        'allergies': allergies,
        'avoidOnionGarlic': avoidOnionGarlic,
        'dietaryNotes': dietaryNotes ?? '',
      };
}

class Profile {
  const Profile({
    required this.id,
    required this.name,
    this.email,
    this.canSetEmail = false,
    this.phone,
    this.phoneVerified = false,
    this.locale = 'en',
    this.marketingOptIn = false,
    this.preferences = const FoodPreferences(),
  });
  final String id;
  final String name;
  final String? email;
  final bool canSetEmail;
  final String? phone;
  final bool phoneVerified;
  final String locale;
  final bool marketingOptIn;
  final FoodPreferences preferences;

  factory Profile.fromJson(Json j) => Profile(
        id: j.str('id'),
        name: j.str('name'),
        email: j.strOrNull('email'),
        canSetEmail: j.boolean('canSetEmail'),
        phone: j.strOrNull('phone'),
        phoneVerified: j.boolean('phoneVerified'),
        locale: j.str('locale', 'en'),
        marketingOptIn: j.boolean('marketingOptIn'),
        preferences: FoodPreferences.fromJson(j.obj('preferences')),
      );
}

class NotificationPref {
  const NotificationPref(this.topic, this.channel, this.enabled);
  final String topic;
  final String channel;
  final bool enabled;
  factory NotificationPref.fromJson(Json j) => NotificationPref(j.str('topic'), j.str('channel'), j.boolean('enabled'));
  Json toJson() => {'topic': topic, 'channel': channel, 'enabled': enabled};
}

class NotificationPrefs {
  const NotificationPrefs({this.topics = const [], this.channels = const [], this.preferences = const []});
  final List<String> topics;
  final List<String> channels;
  final List<NotificationPref> preferences;

  bool enabled(String topic, String channel) => preferences.any((p) => p.topic == topic && p.channel == channel && p.enabled);

  factory NotificationPrefs.fromJson(Json j) => NotificationPrefs(
        topics: j.strs('topics'),
        channels: j.strs('channels'),
        preferences: j.list('preferences', NotificationPref.fromJson),
      );
}

class Address {
  const Address({
    required this.id,
    this.label = '',
    this.type = 'HOME',
    this.recipientName = '',
    this.phone = '',
    this.placeName,
    this.line1 = '',
    this.area = '',
    this.ward,
    this.municipality,
    this.city = 'Kathmandu',
    this.landmark,
    this.instructions,
    this.lat,
    this.lng,
    this.isDefault = false,
    this.covered = false,
    this.zoneName,
  });

  final String id;
  final String label;
  final String type;
  final String recipientName;
  final String phone;
  final String? placeName;
  final String line1;
  final String area;
  final int? ward;
  final String? municipality;
  final String city;
  final String? landmark;
  final String? instructions;
  final double? lat;
  final double? lng;
  final bool isDefault;
  final bool covered;
  final String? zoneName;

  String get oneLine => [placeName, line1, area, if (ward != null) 'Ward $ward', municipality ?? city]
      .whereType<String>()
      .where((s) => s.trim().isNotEmpty)
      .join(', ');

  factory Address.fromJson(Json j) => Address(
        id: j.str('id'),
        label: j.str('label'),
        type: j.str('type', 'HOME'),
        recipientName: j.str('recipientName'),
        phone: j.str('phone'),
        placeName: j.strOrNull('placeName'),
        line1: j.str('line1'),
        area: j.str('area'),
        ward: j.intOrNull('ward'),
        municipality: j.strOrNull('municipality'),
        city: j.str('city', 'Kathmandu'),
        landmark: j.strOrNull('landmark'),
        instructions: j.strOrNull('instructions'),
        lat: j.dblOrNull('lat'),
        lng: j.dblOrNull('lng'),
        isDefault: j.boolean('isDefault'),
        covered: j.boolean('covered'),
        zoneName: j.objOrNull('zone')?.strOrNull('name'),
      );
}

/// A cart line sent to /cart/quote and POST /orders.
class CartLine {
  const CartLine({required this.kind, required this.id, required this.date, required this.qty, this.subs = const []});
  final String kind;
  final String id;
  final String date;
  final int qty;
  final List<String> subs;

  Json toJson() => {'kind': kind, 'id': id, 'date': date, 'qty': qty, if (subs.isNotEmpty) 'subs': subs};
}

class QuoteLine {
  const QuoteLine({
    required this.key,
    required this.id,
    required this.date,
    required this.qty,
    required this.name,
    required this.unitPrice,
    this.kind = 'box',
    this.diet = '',
    this.allergens = const [],
    this.customizations = const [],
    this.problem,
    this.warning,
  });
  final String key;
  final String kind;
  final String id;
  final String date;
  final int qty;
  final String name;
  final int unitPrice;
  final String diet;
  final List<String> allergens;
  final List<String> customizations;
  final String? problem;
  final String? warning;

  factory QuoteLine.fromJson(Json j) => QuoteLine(
        key: j.str('key'),
        kind: j.str('kind', 'box'),
        id: j.str('id'),
        date: j.str('date'),
        qty: j.integer('qty', 1),
        name: j.str('name'),
        unitPrice: j.integer('unitPrice'),
        diet: j.str('diet'),
        allergens: j.strs('allergens'),
        customizations: j.strs('customizations'),
        problem: j.strOrNull('problem'),
        warning: j.strOrNull('warning'),
      );
}

/// POST /cart/quote.
class CartQuote {
  const CartQuote({
    this.ok = false,
    this.error,
    this.addressProblem,
    this.lines = const [],
    this.subtotal = 0,
    this.deliveryFee = 0,
    this.companyDiscount = 0,
    this.couponDiscount = 0,
    this.tax = 0,
    this.taxInclusive = true,
    this.total = 0,
    this.companyShare = 0,
    this.customerShare = 0,
    this.couponCode,
    this.couponError,
    this.companyName,
  });

  final bool ok;
  final String? error;
  final String? addressProblem;
  final List<QuoteLine> lines;
  final int subtotal;
  final int deliveryFee;
  final int companyDiscount;
  final int couponDiscount;
  final int tax;
  final bool taxInclusive;
  final int total;
  final int companyShare;
  final int customerShare;
  final String? couponCode;
  final String? couponError;
  final String? companyName;

  factory CartQuote.fromJson(Json j) => CartQuote(
        ok: j.boolean('ok'),
        error: j.strOrNull('error'),
        addressProblem: j.strOrNull('addressProblem'),
        lines: j.list('lines', QuoteLine.fromJson),
        subtotal: j.integer('subtotal'),
        deliveryFee: j.integer('deliveryFee'),
        companyDiscount: j.integer('companyDiscount'),
        couponDiscount: j.integer('couponDiscount'),
        tax: j.integer('tax'),
        taxInclusive: j.boolean('taxInclusive', true),
        total: j.integer('total'),
        companyShare: j.integer('companyShare'),
        customerShare: j.integer('customerShare'),
        couponCode: j.strOrNull('couponCode'),
        couponError: j.strOrNull('couponError'),
        companyName: j.objOrNull('company')?.strOrNull('name'),
      );
}

class PaymentBrief {
  const PaymentBrief({required this.id, this.reference = '', this.method = '', this.status = 'PENDING', this.amount = 0, this.purpose = 'ORDER'});
  final String id;
  final String reference;
  final String method;
  final String status;
  final int amount;
  final String purpose;

  factory PaymentBrief.fromJson(Json j) => PaymentBrief(
        id: j.str('id'),
        reference: j.str('reference'),
        method: j.str('method'),
        status: j.str('status', 'PENDING'),
        amount: j.integer('amount'),
        purpose: j.str('purpose', 'ORDER'),
      );
}

/// Result of a purchase (POST /orders, /subscriptions, /renew, /meals, /wallet/topups): pay next or done.
class PurchaseResult {
  const PurchaseResult({this.payment, this.needsPayment = false, this.next = 'DONE', this.orderIds = const [], this.subscriptionId});
  final PaymentBrief? payment;
  final bool needsPayment;
  final String next;
  final List<String> orderIds;
  final String? subscriptionId;

  bool get mustPay => next == 'PAY' && payment != null;

  factory PurchaseResult.fromJson(Json j) => PurchaseResult(
        payment: j.objOrNull('payment') == null ? null : PaymentBrief.fromJson(j.obj('payment')),
        needsPayment: j.boolean('needsPayment'),
        next: j.str('next', 'DONE'),
        orderIds: [
          ...j.objs('orders').map((o) => o.str('id')),
          if (j.objOrNull('order') != null) j.obj('order').str('id'),
        ],
        subscriptionId: j.objOrNull('subscription')?.strOrNull('id'),
      );
}

class ItemQty {
  const ItemQty(this.name, this.quantity);
  final String name;
  final int quantity;
  factory ItemQty.fromJson(Json j) => ItemQty(j.str('name'), j.integer('quantity', j.integer('qty', 1)));
  @override
  String toString() => quantity > 1 ? '$quantity × $name' : name;
}

class OrderSummary {
  const OrderSummary({
    required this.id,
    required this.number,
    required this.status,
    this.paymentStatus = '',
    this.source = '',
    this.deliveryDate = '',
    this.slotLabel,
    this.placeName,
    this.area = '',
    this.total = 0,
    this.customerShare = 0,
    this.subscriptionId,
    this.items = const [],
    this.paymentId,
    this.paymentMethod,
    this.deliveryOtp,
  });

  final String id;
  final String number;
  final String status;
  final String paymentStatus;
  final String source;
  final String deliveryDate;
  final String? slotLabel;
  final String? placeName;
  final String area;
  final int total;
  final int customerShare;
  final String? subscriptionId;
  final List<ItemQty> items;
  final String? paymentId;
  final String? paymentMethod;

  /// Hand-off code — only while OUT_FOR_DELIVERY (customer's own order).
  final String? deliveryOtp;

  factory OrderSummary.fromJson(Json j) => OrderSummary(
        id: j.str('id'),
        number: j.str('number'),
        status: j.str('status'),
        paymentStatus: j.str('paymentStatus'),
        source: j.str('source'),
        deliveryDate: j.str('deliveryDate'),
        slotLabel: j.strOrNull('slotLabel'),
        placeName: j.strOrNull('placeName'),
        area: j.str('area'),
        total: j.integer('total'),
        customerShare: j.integer('customerShare'),
        subscriptionId: j.strOrNull('subscriptionId'),
        items: j.list('items', ItemQty.fromJson),
        paymentId: j.objOrNull('payment')?.strOrNull('id'),
        paymentMethod: j.objOrNull('payment')?.strOrNull('method'),
        deliveryOtp: j.strOrNull('deliveryOtp'),
      );
}

class OrderItem {
  const OrderItem({required this.name, this.quantity = 1, this.unitPrice = 0, this.lineTotal = 0, this.diet, this.components = const [], this.customizations = const []});
  final String name;
  final int quantity;
  final int unitPrice;
  final int lineTotal;
  final String? diet;
  final List<String> components;
  final List<String> customizations;

  factory OrderItem.fromJson(Json j) => OrderItem(
        name: j.str('name'),
        quantity: j.integer('quantity', 1),
        unitPrice: j.integer('unitPrice'),
        lineTotal: j.integer('lineTotal'),
        diet: j.strOrNull('diet'),
        components: j.objs('components').map((c) => c.integer('qty', 1) > 1 ? '${c.integer('qty')} × ${c.str('name')}' : c.str('name')).toList(),
        customizations: j.objs('customizations').map((c) => c.str('label')).toList(),
      );
}

class OrderActions {
  const OrderActions({this.cancel = false, this.skip = false, this.unskip = false, this.swap = false, this.feedback = false, this.pay = false});
  final bool cancel;
  final bool skip;
  final bool unskip;
  final bool swap;
  final bool feedback;
  final bool pay;

  factory OrderActions.fromJson(Json j) => OrderActions(
        cancel: j.boolean('cancel'),
        skip: j.boolean('skip'),
        unskip: j.boolean('unskip'),
        swap: j.boolean('swap'),
        feedback: j.boolean('feedback'),
        pay: j.boolean('pay'),
      );
}

class OrderDetail {
  const OrderDetail({
    required this.id,
    required this.number,
    required this.status,
    this.paymentStatus = '',
    this.source = '',
    this.deliveryDate = '',
    this.slotLabel,
    this.deliveryOtp,
    this.delivery = const {},
    this.items = const [],
    this.money = const {},
    this.allergenNote,
    this.notes,
    this.payment,
    this.subscriptionId,
    this.subscriptionPlanName,
    this.refunds = const [],
    this.feedbackRating,
    this.windowOpen = false,
    this.cutoff = '',
    this.actions = const OrderActions(),
    this.createdAt,
    this.deliveredAt,
  });

  final String id;
  final String number;
  final String status;
  final String paymentStatus;
  final String source;
  final String deliveryDate;
  final String? slotLabel;
  final String? deliveryOtp;
  final Json delivery;
  final List<OrderItem> items;
  final Json money;
  final String? allergenNote;
  final String? notes;
  final PaymentBrief? payment;
  final String? subscriptionId;
  final String? subscriptionPlanName;
  final List<Json> refunds;
  final int? feedbackRating;
  final bool windowOpen;
  final String cutoff;
  final OrderActions actions;
  final DateTime? createdAt;
  final DateTime? deliveredAt;

  bool get isPlanMeal => source == 'SUBSCRIPTION';

  factory OrderDetail.fromJson(Json j) => OrderDetail(
        id: j.str('id'),
        number: j.str('number'),
        status: j.str('status'),
        paymentStatus: j.str('paymentStatus'),
        source: j.str('source'),
        deliveryDate: j.str('deliveryDate'),
        slotLabel: j.strOrNull('slotLabel'),
        deliveryOtp: j.strOrNull('deliveryOtp'),
        delivery: j.obj('delivery'),
        items: j.list('items', OrderItem.fromJson),
        money: j.obj('money'),
        allergenNote: j.strOrNull('allergenNote'),
        notes: j.strOrNull('notes'),
        payment: j.objOrNull('payment') == null ? null : PaymentBrief.fromJson(j.obj('payment')),
        subscriptionId: j.objOrNull('subscription')?.strOrNull('id'),
        subscriptionPlanName: j.objOrNull('subscription')?.strOrNull('planName'),
        refunds: j.objs('refunds'),
        feedbackRating: j.objOrNull('feedback')?.intOrNull('rating'),
        windowOpen: j.obj('window').boolean('open'),
        cutoff: j.obj('window').str('cutoff'),
        actions: OrderActions.fromJson(j.obj('actions')),
        createdAt: j.date('createdAt'),
        deliveredAt: j.date('deliveredAt'),
      );
}

class TimelineEvent {
  const TimelineEvent({required this.id, required this.kind, this.at, this.fromStatus, this.toStatus, this.type, this.note});
  final String id;
  final String kind;
  final DateTime? at;
  final String? fromStatus;
  final String? toStatus;
  final String? type;
  final String? note;
  factory TimelineEvent.fromJson(Json j) => TimelineEvent(
        id: j.str('id'),
        kind: j.str('kind'),
        at: j.date('at'),
        fromStatus: j.strOrNull('fromStatus'),
        toStatus: j.strOrNull('toStatus'),
        type: j.strOrNull('type'),
        note: j.strOrNull('note'),
      );
}

class OrderTimeline {
  const OrderTimeline({this.status = '', this.steps = const [], this.currentStep = -1, this.events = const []});
  final String status;
  final List<String> steps;
  final int currentStep;
  final List<TimelineEvent> events;
  factory OrderTimeline.fromJson(Json j) => OrderTimeline(
        status: j.str('status'),
        steps: j.strs('steps'),
        currentStep: j.integer('currentStep', -1),
        events: j.list('events', TimelineEvent.fromJson),
      );
}

class SwapOption {
  const SwapOption({required this.boxId, required this.name, this.isVeg = false, this.price = 0, this.delta = 0, this.current = false, this.soldOut = false});
  final String boxId;
  final String name;
  final bool isVeg;
  final int price;
  final int delta;
  final bool current;
  final bool soldOut;
  factory SwapOption.fromJson(Json j) => SwapOption(
        boxId: j.str('boxId'),
        name: j.str('name'),
        isVeg: j.boolean('isVeg'),
        price: j.integer('price'),
        delta: j.integer('delta'),
        current: j.boolean('current'),
        soldOut: j.boolean('soldOut'),
      );
}

class SwapResult {
  const SwapResult({this.changed = false, this.delta = 0, this.settlement = 'NONE', this.paymentId, this.next = 'DONE', this.message = ''});
  final bool changed;
  final int delta;
  final String settlement;
  final String? paymentId;
  final String next;
  final String message;
  factory SwapResult.fromJson(Json j) => SwapResult(
        changed: j.boolean('changed'),
        delta: j.integer('delta'),
        settlement: j.str('settlement', 'NONE'),
        paymentId: j.strOrNull('paymentId'),
        next: j.str('next', 'DONE'),
        message: j.str('message'),
      );
}

class PaymentListItem {
  const PaymentListItem({required this.id, this.reference = '', this.method = '', this.status = '', this.purpose = '', this.amount = 0, this.refundedAmount = 0, this.paidAt, this.createdAt, this.orderCount = 0});
  final String id;
  final String reference;
  final String method;
  final String status;
  final String purpose;
  final int amount;
  final int refundedAmount;
  final DateTime? paidAt;
  final DateTime? createdAt;
  final int orderCount;
  factory PaymentListItem.fromJson(Json j) => PaymentListItem(
        id: j.str('id'),
        reference: j.str('reference'),
        method: j.str('method'),
        status: j.str('status'),
        purpose: j.str('purpose'),
        amount: j.integer('amount'),
        refundedAmount: j.integer('refundedAmount'),
        paidAt: j.date('paidAt'),
        createdAt: j.date('createdAt'),
        orderCount: j.integer('orderCount'),
      );
}

class PaymentDetail {
  const PaymentDetail({
    required this.id,
    this.reference = '',
    this.purpose = '',
    this.method = '',
    this.status = 'PENDING',
    this.amount = 0,
    this.refundedAmount = 0,
    this.paidAt,
    this.expired = false,
    this.proofSubmitted = false,
    this.awaitingVerification = false,
    this.switchableMethods = const [],
    this.bankDetails,
    this.bankQrImage,
    this.orders = const [],
    this.subscriptionPlanName,
  });

  final String id;
  final String reference;
  final String purpose;
  final String method;
  final String status;
  final int amount;
  final int refundedAmount;
  final DateTime? paidAt;
  final bool expired;
  final bool proofSubmitted;
  final bool awaitingVerification;
  final List<String> switchableMethods;
  final String? bankDetails;
  final String? bankQrImage;
  final List<Json> orders;
  final String? subscriptionPlanName;

  bool get isPaid => status == 'PAID' || status == 'PARTIALLY_REFUNDED' || status == 'REFUNDED';
  bool get isOpen => (status == 'PENDING' || status == 'FAILED') && !expired;
  bool get isGateway => method == 'ESEWA' || method == 'KHALTI';

  factory PaymentDetail.fromJson(Json j) => PaymentDetail(
        id: j.str('id'),
        reference: j.str('reference'),
        purpose: j.str('purpose'),
        method: j.str('method'),
        status: j.str('status', 'PENDING'),
        amount: j.integer('amount'),
        refundedAmount: j.integer('refundedAmount'),
        paidAt: j.date('paidAt'),
        expired: j.boolean('expired'),
        proofSubmitted: j.boolean('proofSubmitted'),
        awaitingVerification: j.boolean('awaitingVerification'),
        switchableMethods: j.strs('switchableMethods'),
        bankDetails: j.objOrNull('bankTransfer')?.strOrNull('bankDetails'),
        bankQrImage: j.objOrNull('bankTransfer')?.strOrNull('qrImage'),
        orders: j.objs('orders'),
        subscriptionPlanName: j.objOrNull('subscription')?.strOrNull('planName'),
      );
}

/// POST /payments/{id}/start.
class PaymentStart {
  const PaymentStart({required this.kind, this.method, this.action, this.fields = const {}, this.url, this.returnUrlPrefixes = const []});
  final String kind;
  final String? method;
  final String? action;
  final Map<String, String> fields;
  final String? url;
  final List<String> returnUrlPrefixes;

  factory PaymentStart.fromJson(Json j) {
    final f = <String, String>{};
    j.obj('fields').forEach((k, v) {
      if (v != null) f[k] = '$v';
    });
    return PaymentStart(
      kind: j.str('kind'),
      method: j.strOrNull('method'),
      action: j.strOrNull('action'),
      fields: f,
      url: j.strOrNull('url'),
      returnUrlPrefixes: j.strs('returnUrlPrefixes'),
    );
  }

  /// True when the in-app browser reached a return URL (absolute prefix, or a path prefix like "/thank-you/").
  bool isReturnUrl(String url) {
    final uri = Uri.tryParse(url);
    for (final p in returnUrlPrefixes) {
      if (p.isEmpty) continue;
      if (url.startsWith(p)) return true;
      if (p.startsWith('/') && uri != null && uri.path.startsWith(p)) return true;
    }
    return false;
  }
}

class PlanQuoteMeal {
  const PlanQuoteMeal({required this.date, this.name = '', this.price = 0, this.surcharge = 0, this.followsRotation = true, this.problem});
  final String date;
  final String name;
  final int price;
  final int surcharge;
  final bool followsRotation;
  final String? problem;
  factory PlanQuoteMeal.fromJson(Json j) => PlanQuoteMeal(
        date: j.str('date'),
        name: j.str('name'),
        price: j.integer('price'),
        surcharge: j.integer('surcharge'),
        followsRotation: j.boolean('followsRotation', true),
        problem: j.strOrNull('problem'),
      );
}

/// POST /subscriptions/quote (also inside renewal-quote).
class PlanQuote {
  const PlanQuote({
    this.ok = false,
    this.error,
    this.addressProblem,
    this.meals = const [],
    this.skippedDates = const [],
    this.closures = const [],
    this.mealsTotal = 0,
    this.perMealEffective = 0,
    this.subtotal = 0,
    this.deliveryFee = 0,
    this.discount = 0,
    this.couponDiscount = 0,
    this.companyDiscount = 0,
    this.tax = 0,
    this.total = 0,
    this.customerShare = 0,
    this.savings = 0,
    this.endDate,
    this.couponError,
  });

  final bool ok;
  final String? error;
  final String? addressProblem;
  final List<PlanQuoteMeal> meals;
  final List<String> skippedDates;
  final List<String> closures;
  final int mealsTotal;
  final int perMealEffective;
  final int subtotal;
  final int deliveryFee;
  final int discount;
  final int couponDiscount;
  final int companyDiscount;
  final int tax;
  final int total;
  final int customerShare;
  final int savings;
  final String? endDate;
  final String? couponError;

  factory PlanQuote.fromJson(Json j) => PlanQuote(
        ok: j.boolean('ok'),
        error: j.strOrNull('error'),
        addressProblem: j.strOrNull('addressProblem'),
        meals: j.list('meals', PlanQuoteMeal.fromJson),
        skippedDates: j.strs('skippedDates'),
        closures: j.objs('closures').map((c) => '${c.str('date')} · ${c.str('name')}').toList(),
        mealsTotal: j.integer('mealsTotal'),
        perMealEffective: j.integer('perMealEffective'),
        subtotal: j.integer('subtotal'),
        deliveryFee: j.integer('deliveryFee'),
        discount: j.integer('discount'),
        couponDiscount: j.integer('couponDiscount'),
        companyDiscount: j.integer('companyDiscount'),
        tax: j.integer('tax'),
        total: j.integer('total'),
        customerShare: j.integer('customerShare', j.integer('total')),
        savings: j.integer('savings'),
        endDate: j.strOrNull('endDate'),
        couponError: j.strOrNull('couponError'),
      );
}

class SubscriptionSummary {
  const SubscriptionSummary({
    required this.id,
    this.reference = '',
    this.status = '',
    this.planName = '',
    this.planSlug = '',
    this.startDate = '',
    this.endDate = '',
    this.days = const [],
    this.mealsTotal = 0,
    this.mealsDelivered = 0,
    this.total = 0,
    this.pausedUntil,
  });
  final String id;
  final String reference;
  final String status;
  final String planName;
  final String planSlug;
  final String startDate;
  final String endDate;
  final List<String> days;
  final int mealsTotal;
  final int mealsDelivered;
  final int total;
  final String? pausedUntil;

  double get progress => mealsTotal == 0 ? 0 : (mealsDelivered / mealsTotal).clamp(0, 1).toDouble();

  factory SubscriptionSummary.fromJson(Json j) => SubscriptionSummary(
        id: j.str('id'),
        reference: j.str('reference'),
        status: j.str('status'),
        planName: j.obj('plan').str('name'),
        planSlug: j.obj('plan').str('slug'),
        startDate: j.str('startDate'),
        endDate: j.str('endDate'),
        days: j.strs('days'),
        mealsTotal: j.integer('mealsTotal'),
        mealsDelivered: j.integer('mealsDelivered'),
        total: j.integer('total'),
        pausedUntil: j.strOrNull('pausedUntil'),
      );
}

class PlanMeal {
  const PlanMeal({required this.id, this.number = '', this.deliveryDate = '', this.status = '', this.paymentStatus = '', this.items = const [], this.windowOpen = false, this.cutoff = '', this.deliveryOtp});
  final String id;
  final String number;
  final String deliveryDate;
  final String status;
  final String paymentStatus;
  final List<ItemQty> items;
  final bool windowOpen;
  final String cutoff;
  final String? deliveryOtp;
  factory PlanMeal.fromJson(Json j) => PlanMeal(
        id: j.str('id'),
        number: j.str('number'),
        deliveryDate: j.str('deliveryDate'),
        status: j.str('status'),
        paymentStatus: j.str('paymentStatus'),
        items: j.list('items', ItemQty.fromJson),
        windowOpen: j.obj('window').boolean('open'),
        cutoff: j.obj('window').str('cutoff'),
        deliveryOtp: j.strOrNull('deliveryOtp'),
      );
}

class SubscriptionDetail {
  const SubscriptionDetail({
    required this.id,
    this.reference = '',
    this.status = '',
    this.planName = '',
    this.planSlug = '',
    this.startDate = '',
    this.endDate = '',
    this.days = const [],
    this.vegOnly = false,
    this.slotId,
    this.pausedUntil,
    this.money = const {},
    this.address,
    this.skipText = '',
    this.cancelText = '',
    this.cancelPolicy = '',
    this.meals = const [],
    this.pendingSwapPayments = const [],
    this.extraMeals = const [],
  });

  final String id;
  final String reference;
  final String status;
  final String planName;
  final String planSlug;
  final String startDate;
  final String endDate;
  final List<String> days;
  final bool vegOnly;
  final String? slotId;
  final String? pausedUntil;
  final Json money;
  final Address? address;
  final String skipText;
  final String cancelText;
  final String cancelPolicy;
  final List<PlanMeal> meals;
  final List<Json> pendingSwapPayments;
  final List<Json> extraMeals;

  bool get isLive => status == 'ACTIVE' || status == 'PAUSED' || status == 'PENDING_PAYMENT';

  factory SubscriptionDetail.fromJson(Json j) {
    final pol = j.obj('policies');
    return SubscriptionDetail(
      id: j.str('id'),
      reference: j.str('reference'),
      status: j.str('status'),
      planName: j.obj('plan').str('name'),
      planSlug: j.obj('plan').str('slug'),
      startDate: j.str('startDate'),
      endDate: j.str('endDate'),
      days: j.strs('days'),
      vegOnly: j.boolean('vegOnly'),
      slotId: j.strOrNull('slotId'),
      pausedUntil: j.strOrNull('pausedUntil'),
      money: j.obj('money'),
      address: j.objOrNull('address') == null ? null : Address.fromJson(j.obj('address')),
      skipText: pol.str('skipText'),
      cancelText: pol.str('cancelText'),
      cancelPolicy: pol.str('cancel'),
      meals: j.list('meals', PlanMeal.fromJson),
      pendingSwapPayments: j.objs('pendingSwapPayments'),
      extraMeals: j.objs('extraMeals'),
    );
  }
}

class RenewalQuote {
  const RenewalQuote({this.existingRenewal = false, this.startDate = '', this.weeks = 1, this.quote = const PlanQuote()});
  final bool existingRenewal;
  final String startDate;
  final int weeks;
  final PlanQuote quote;
  factory RenewalQuote.fromJson(Json j) => RenewalQuote(
        existingRenewal: j.objOrNull('existingRenewal') != null,
        startDate: j.str('startDate'),
        weeks: j.integer('weeks', 1),
        quote: PlanQuote.fromJson(j.obj('quote')),
      );
}

class Wallet {
  const Wallet({
    this.balance = 0,
    this.walletEnabled = false,
    this.topupEnabled = false,
    this.topupMethods = const [],
    this.min,
    this.max,
    this.maxNow,
    this.note,
  });
  final int balance;
  final bool walletEnabled;
  final bool topupEnabled;
  final List<String> topupMethods;
  final int? min;
  final int? max;
  final int? maxNow;
  final String? note;

  factory Wallet.fromJson(Json j) {
    final t = j.obj('topup');
    return Wallet(
      balance: j.integer('balance'),
      walletEnabled: j.boolean('walletEnabled'),
      topupEnabled: t.boolean('enabled'),
      topupMethods: t.strs('methods'),
      min: t.intOrNull('min'),
      max: t.intOrNull('max'),
      maxNow: t.intOrNull('maxNow'),
      note: t.strOrNull('note'),
    );
  }
}

class LedgerEntry {
  const LedgerEntry({required this.id, this.amount = 0, this.reason = '', this.reasonLabel = '', this.note, this.createdAt});
  final String id;
  final int amount;
  final String reason;
  final String reasonLabel;
  final String? note;
  final DateTime? createdAt;
  factory LedgerEntry.fromJson(Json j) => LedgerEntry(
        id: j.str('id'),
        amount: j.integer('amount'),
        reason: j.str('reason'),
        reasonLabel: j.str('reasonLabel', j.str('reason')),
        note: j.strOrNull('note'),
        createdAt: j.date('createdAt'),
      );
}

class AppNotification {
  const AppNotification({required this.id, this.type = '', this.title = '', this.body, this.link, this.readAt, this.createdAt});
  final String id;
  final String type;
  final String title;
  final String? body;
  final String? link;
  final DateTime? readAt;
  final DateTime? createdAt;
  bool get unread => readAt == null;
  factory AppNotification.fromJson(Json j) => AppNotification(
        id: j.str('id'),
        type: j.str('type'),
        title: j.str('title'),
        body: j.strOrNull('body'),
        link: j.strOrNull('link'),
        readAt: j.date('readAt'),
        createdAt: j.date('createdAt'),
      );
}

class Referrals {
  const Referrals({this.enabled = false, this.code, this.shareText, this.shareUrl, this.friends = const [], this.rewarded = 0, this.rewardCount = 0, this.canClaim = false});
  final bool enabled;
  final String? code;
  final String? shareText;
  final String? shareUrl;
  final List<({String name, String status})> friends;
  final int rewarded;
  final int rewardCount;
  final bool canClaim;
  factory Referrals.fromJson(Json j) => Referrals(
        enabled: j.boolean('enabled'),
        code: j.strOrNull('code'),
        shareText: j.strOrNull('shareText'),
        shareUrl: j.strOrNull('shareUrl'),
        friends: j.objs('friends').map((f) => (name: f.str('name'), status: f.str('status'))).toList(),
        rewarded: j.integer('rewarded'),
        rewardCount: j.integer('rewardCount'),
        canClaim: j.boolean('canClaim'),
      );
}

class TicketSummary {
  const TicketSummary({required this.id, this.number = '', this.subject = '', this.category = '', this.status = '', this.messageCount = 0, this.updatedAt});
  final String id;
  final String number;
  final String subject;
  final String category;
  final String status;
  final int messageCount;
  final DateTime? updatedAt;
  factory TicketSummary.fromJson(Json j) => TicketSummary(
        id: j.str('id'),
        number: j.str('number'),
        subject: j.str('subject'),
        category: j.str('category'),
        status: j.str('status'),
        messageCount: j.integer('messageCount'),
        updatedAt: j.date('updatedAt'),
      );
}

class TicketMessage {
  const TicketMessage({required this.id, this.body = '', this.fromMe = false, this.author = '', this.createdAt});
  final String id;
  final String body;
  final bool fromMe;
  final String author;
  final DateTime? createdAt;
  factory TicketMessage.fromJson(Json j) =>
      TicketMessage(id: j.str('id'), body: j.str('body'), fromMe: j.boolean('fromMe'), author: j.str('author'), createdAt: j.date('createdAt'));
}

class TicketDetail {
  const TicketDetail({required this.id, this.number = '', this.subject = '', this.status = '', this.canReply = false, this.messages = const []});
  final String id;
  final String number;
  final String subject;
  final String status;
  final bool canReply;
  final List<TicketMessage> messages;
  factory TicketDetail.fromJson(Json j) => TicketDetail(
        id: j.str('id'),
        number: j.str('number'),
        subject: j.str('subject'),
        status: j.str('status'),
        canReply: j.boolean('canReply'),
        messages: j.list('messages', TicketMessage.fromJson),
      );
}

class PrivacyRequest {
  const PrivacyRequest({required this.id, this.type = '', this.status = '', this.createdAt});
  final String id;
  final String type;
  final String status;
  final DateTime? createdAt;
  factory PrivacyRequest.fromJson(Json j) => PrivacyRequest(id: j.str('id'), type: j.str('type'), status: j.str('status'), createdAt: j.date('createdAt'));
}
