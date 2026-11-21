import '../core/json.dart';

/// GET /settings (public app bootstrap).
class AppSettings {
  const AppSettings({
    this.brandName = 'Dabba Bela',
    this.brandNameNe = 'डब्बा बेला',
    this.contactPhone,
    this.contactWhatsapp,
    this.contactEmail,
    this.today,
    this.orderCutoff = '09:30',
    this.advanceDays = 7,
    this.minOrderAmount = 0,
    this.paymentMethods = const [],
    this.maintenance = false,
    this.maintenanceMessage,
    this.flags = const {},
  });

  final String brandName;
  final String brandNameNe;
  final String? contactPhone;
  final String? contactWhatsapp;
  final String? contactEmail;
  final String? today;
  final String orderCutoff;
  final int advanceDays;
  final int minOrderAmount;
  final List<String> paymentMethods;
  final bool maintenance;
  final String? maintenanceMessage;
  final Map<String, bool> flags;

  bool flag(String name) => flags[name] ?? false;

  factory AppSettings.fromJson(Json j) {
    final brand = j.obj('brand');
    final contact = j.obj('contact');
    final ordering = j.obj('ordering');
    final maintenance = j.obj('maintenance');
    final flags = <String, bool>{};
    j.obj('flags').forEach((k, v) {
      if (v is bool) flags[k] = v;
    });
    return AppSettings(
      brandName: brand.str('name', 'Dabba Bela'),
      brandNameNe: brand.str('nameNe', 'डब्बा बेला'),
      contactPhone: contact.strOrNull('phone'),
      contactWhatsapp: contact.strOrNull('whatsapp'),
      contactEmail: contact.strOrNull('email'),
      today: ordering.strOrNull('today'),
      orderCutoff: ordering.str('orderCutoff', '09:30'),
      advanceDays: ordering.integer('advanceDays', 7),
      minOrderAmount: ordering.integer('minOrderAmount'),
      paymentMethods: j.strs('paymentMethods'),
      maintenance: maintenance.boolean('on'),
      maintenanceMessage: maintenance.strOrNull('message'),
      flags: flags,
    );
  }
}

class Allergen {
  const Allergen({required this.code, required this.name, this.mayContain = false});
  final String code;
  final String name;
  final bool mayContain;

  factory Allergen.fromJson(Json j) =>
      Allergen(code: j.str('code'), name: j.str('name', j.str('code')), mayContain: j.boolean('mayContain'));
}

class BoxItem {
  const BoxItem({required this.name, this.qty = 1});
  final String name;
  final int qty;
  factory BoxItem.fromJson(Json j) => BoxItem(name: j.str('name'), qty: j.integer('qty', 1));
}

class BoxSubstitution {
  const BoxSubstitution({required this.id, required this.from, required this.to, this.priceDelta = 0});
  final String id;
  final String from;
  final String to;
  final int priceDelta;
  factory BoxSubstitution.fromJson(Json j) =>
      BoxSubstitution(id: j.str('id'), from: j.str('from'), to: j.str('to'), priceDelta: j.integer('priceDelta'));
}

/// `PublicBox` — one dabba.
class PublicBox {
  const PublicBox({
    required this.id,
    required this.slug,
    required this.name,
    required this.price,
    this.tagline,
    this.description,
    this.healthNote,
    this.image,
    this.diet = '',
    this.isVeg = false,
    this.spice = 0,
    this.allergens = const [],
    this.items = const [],
    this.subs = const [],
    this.nutrition = const {},
    this.isSpecial = false,
  });

  final String id;
  final String slug;
  final String name;
  final int price;
  final String? tagline;
  final String? description;
  final String? healthNote;
  final String? image;
  final String diet;
  final bool isVeg;
  final int spice;
  final List<Allergen> allergens;
  final List<BoxItem> items;
  final List<BoxSubstitution> subs;

  /// Free-form nutrition facts (`kcal`, `protein`, … plus `verified`/`estimated` markers) as sent by the API.
  final Json nutrition;
  final bool isSpecial;

  factory PublicBox.fromJson(Json j) => PublicBox(
        id: j.str('id'),
        slug: j.str('slug', j.str('id')),
        name: j.str('name'),
        price: j.integer('price'),
        tagline: j.strOrNull('tagline'),
        description: j.strOrNull('description') ?? j.strOrNull('shortDescription'),
        healthNote: j.strOrNull('healthNote'),
        image: j.strOrNull('image'),
        diet: j.str('diet'),
        isVeg: j.boolean('isVeg'),
        spice: j.integer('spice'),
        allergens: j.list('allergens', Allergen.fromJson),
        items: j.list('items', BoxItem.fromJson),
        subs: j.list('subs', BoxSubstitution.fromJson),
        nutrition: j.obj('nutrition'),
        isSpecial: j.boolean('isSpecial'),
      );
}

class MenuItem {
  const MenuItem({required this.box, this.isPrimary = false, this.soldOut = false, this.remaining});
  final PublicBox box;
  final bool isPrimary;
  final bool soldOut;
  final int? remaining;

  factory MenuItem.fromJson(Json j) => MenuItem(
        box: PublicBox.fromJson(j.obj('box')),
        isPrimary: j.boolean('isPrimary'),
        soldOut: j.boolean('soldOut'),
        remaining: j.intOrNull('remaining'),
      );
}

class MenuDay {
  const MenuDay({
    required this.date,
    this.weekday = '',
    this.label = '',
    this.orderable = false,
    this.problem,
    this.cutoff = '',
    this.closed = false,
    this.note,
    this.items = const [],
  });

  final String date;
  final String weekday;
  final String label;
  final bool orderable;
  final String? problem;
  final String cutoff;
  final bool closed;
  final String? note;
  final List<MenuItem> items;

  factory MenuDay.fromJson(Json j) => MenuDay(
        date: j.str('date'),
        weekday: j.str('weekday'),
        label: j.str('label'),
        orderable: j.boolean('orderable'),
        problem: j.strOrNull('problem'),
        cutoff: j.str('cutoff'),
        closed: j.boolean('closed'),
        note: j.strOrNull('note'),
        items: j.list('items', MenuItem.fromJson),
      );
}

/// GET /menu.
class MenuWeek {
  const MenuWeek({required this.weekStart, this.hasMenu = false, this.companyMenuName, this.days = const []});
  final String weekStart;
  final bool hasMenu;

  /// Set when the caller is a company member and the API narrowed the menu to the company's list.
  final String? companyMenuName;
  final List<MenuDay> days;

  factory MenuWeek.fromJson(Json j) => MenuWeek(
        weekStart: j.str('weekStart'),
        hasMenu: j.boolean('hasMenu'),
        companyMenuName: j.objOrNull('companyMenu')?.strOrNull('companyName'),
        days: j.list('days', MenuDay.fromJson),
      );
}

class BoxDate {
  const BoxDate({required this.date, this.label = '', this.price = 0, this.soldOut = false, this.remaining});
  final String date;
  final String label;
  final int price;
  final bool soldOut;
  final int? remaining;

  factory BoxDate.fromJson(Json j) => BoxDate(
        date: j.str('date'),
        label: j.str('label'),
        price: j.integer('price'),
        soldOut: j.boolean('soldOut'),
        remaining: j.intOrNull('remaining'),
      );
}

/// GET /boxes/{slug}.
class BoxDetail {
  const BoxDetail({required this.box, this.offCompanyMenu = false, this.dates = const [], this.allergyHits = const []});
  final PublicBox box;
  final bool offCompanyMenu;
  final List<BoxDate> dates;
  final List<String> allergyHits;

  factory BoxDetail.fromJson(Json j) => BoxDetail(
        box: PublicBox.fromJson(j.obj('box')),
        offCompanyMenu: j.boolean('offCompanyMenu'),
        dates: j.list('dates', BoxDate.fromJson),
        allergyHits: j.strs('allergyHits'),
      );
}

/// `Plan`.
class Plan {
  const Plan({
    required this.id,
    required this.slug,
    required this.name,
    required this.pricePerMeal,
    this.compareAtPrice,
    this.tagline,
    this.description,
    this.weeksDefault = 1,
    this.weeksMin = 1,
    this.weeksMax = 4,
    this.minDaysPerWeek = 1,
    this.maxDaysPerWeek = 6,
    this.skipPolicy = '',
    this.cancelPolicy = '',
    this.skipText,
    this.cancelText,
    this.features = const [],
    this.isPopular = false,
    this.includesDelivery = false,
  });

  final String id;
  final String slug;
  final String name;
  final int pricePerMeal;
  final int? compareAtPrice;
  final String? tagline;
  final String? description;
  final int weeksDefault;
  final int weeksMin;
  final int weeksMax;
  final int minDaysPerWeek;
  final int maxDaysPerWeek;
  final String skipPolicy;
  final String cancelPolicy;
  final String? skipText;
  final String? cancelText;
  final List<String> features;
  final bool isPopular;
  final bool includesDelivery;

  factory Plan.fromJson(Json j) {
    final w = j.obj('weeks');
    final pt = j.obj('policyText');
    return Plan(
      id: j.str('id'),
      slug: j.str('slug', j.str('id')),
      name: j.str('name'),
      pricePerMeal: j.integer('pricePerMeal'),
      compareAtPrice: j.intOrNull('compareAtPrice'),
      tagline: j.strOrNull('tagline'),
      description: j.strOrNull('description'),
      weeksDefault: w.integer('default', 1),
      weeksMin: w.integer('min', 1),
      weeksMax: w.integer('max', 4),
      minDaysPerWeek: j.integer('minDaysPerWeek', 1),
      maxDaysPerWeek: j.integer('maxDaysPerWeek', 6),
      skipPolicy: j.str('skipPolicy'),
      cancelPolicy: j.str('cancelPolicy'),
      skipText: pt.strOrNull('skip'),
      cancelText: pt.strOrNull('cancel'),
      features: j.strs('features'),
      isPopular: j.boolean('isPopular'),
      includesDelivery: j.boolean('includesDelivery'),
    );
  }
}

class Slot {
  const Slot({required this.id, required this.label, this.startTime = '', this.endTime = ''});
  final String id;
  final String label;
  final String startTime;
  final String endTime;
  factory Slot.fromJson(Json j) =>
      Slot(id: j.str('id'), label: j.str('label'), startTime: j.str('startTime'), endTime: j.str('endTime'));
}

class PlanDayOption {
  const PlanDayOption({required this.boxId, required this.name, this.price = 0, this.isVeg = false, this.isPrimary = false, this.soldOut = false});
  final String boxId;
  final String name;
  final int price;
  final bool isVeg;
  final bool isPrimary;
  final bool soldOut;
  factory PlanDayOption.fromJson(Json j) => PlanDayOption(
        boxId: j.str('boxId'),
        name: j.str('name'),
        price: j.integer('price'),
        isVeg: j.boolean('isVeg'),
        isPrimary: j.boolean('isPrimary'),
        soldOut: j.boolean('soldOut'),
      );
}

/// GET /plans/{slug}.
class PlanDetail {
  const PlanDetail({
    required this.plan,
    this.startDates = const [],
    this.dayOptions = const {},
    this.slots = const [],
    this.paymentMethods = const [],
    this.kitchenId,
  });

  final Plan plan;
  final List<String> startDates;
  final Map<String, List<PlanDayOption>> dayOptions;
  final List<Slot> slots;
  final List<String> paymentMethods;
  final String? kitchenId;

  factory PlanDetail.fromJson(Json j) {
    final opts = <String, List<PlanDayOption>>{};
    j.obj('dayOptions').forEach((k, v) => opts[k] = asJsonList(v).map(PlanDayOption.fromJson).toList());
    return PlanDetail(
      plan: Plan.fromJson(j.obj('plan')),
      startDates: j.strs('startDates'),
      dayOptions: opts,
      slots: j.list('slots', Slot.fromJson),
      paymentMethods: j.strs('paymentMethods'),
      kitchenId: j.strOrNull('kitchenId'),
    );
  }
}

/// GET /coverage?area=… (address mode).
class CoverageCheck {
  const CoverageCheck({this.serviceable = false, this.reason, this.zoneName, this.fee, this.slots = const []});
  final bool serviceable;
  final String? reason;
  final String? zoneName;
  final int? fee;
  final List<Slot> slots;

  factory CoverageCheck.fromJson(Json j) => CoverageCheck(
        serviceable: j.boolean('serviceable'),
        reason: j.strOrNull('reason'),
        zoneName: j.objOrNull('zone')?.strOrNull('name'),
        fee: j.objOrNull('fee')?.intOrNull('amount'),
        slots: j.list('slots', Slot.fromJson),
      );
}

/// GET /coverage?q=… (search mode).
class CoverageSearch {
  const CoverageSearch({this.matches = const [], this.valleyNote, this.listedByName = false});
  final List<({String zone, String kitchen, List<String> areas, int? fee})> matches;
  final String? valleyNote;
  final bool listedByName;

  factory CoverageSearch.fromJson(Json j) => CoverageSearch(
        matches: j
            .objs('matches')
            .map((m) => (zone: m.str('zone'), kitchen: m.str('kitchen'), areas: m.strs('areas'), fee: m.intOrNull('fee')))
            .toList(),
        valleyNote: j.objOrNull('valleyWide')?.strOrNull('note'),
        listedByName: j.boolean('listedByName'),
      );
}
