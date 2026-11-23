import 'dart:convert';

import 'package:dabba_bela/core/json.dart';
import 'package:dabba_bela/models/auth.dart';
import 'package:dabba_bela/models/catalog.dart';
import 'package:dabba_bela/models/customer.dart';
import 'package:flutter_test/flutter_test.dart';

import 'helpers.dart';

/// Example payloads shaped exactly like the schemas in docs/api/openapi.yaml (and the DTOs in src/server/api/*).
Json j(String s) => asJson(jsonDecode(s));

void main() {
  test('SignInResult: token and 2FA challenge variants', () {
    final ok = SignInResult.fromJson(j('{"twoFactorRequired":false,"token":"t1","user":{"id":"u1","name":"Sita","email":"s@x.np","phone":null,"role":"CUSTOMER","twoFactorEnabled":false,"locale":"ne"}}'));
    expect(ok.token, 't1');
    expect(ok.user!.locale, 'ne');
    final ch = SignInResult.fromJson(j('{"twoFactorRequired":true,"challengeToken":"c1","token":null}'));
    expect(ch.twoFactorRequired, isTrue);
    expect(ch.challengeToken, 'c1');
    expect(ch.user, isNull);
    final otp = SignInResult.fromJson(j('{"twoFactorRequired":false,"token":"t2","user":null,"isNew":true}'));
    expect(otp.isNew, isTrue);
  });

  test('Me: apps, flags, kitchen scope, 2FA setup', () {
    final me = Me.fromJson(asJson(mePayload(role: 'DELIVERY_AGENT', rider: true, setupRequired: true)));
    expect(me.apps, {AppSection.customer, AppSection.rider});
    expect(me.appList.first, AppSection.customer);
    expect(me.flag('deliveryOtp'), isTrue);
    expect(me.flag('unknownFlag'), isFalse);
    expect(me.kitchens.single.code, 'BAN');
    expect(me.twoFactorSetupRequired, isTrue);
    expect(me.can('rider.view'), isTrue);
    // Unknown fields are ignored; missing apps default to customer only.
    final bare = Me.fromJson(j('{"user":{"id":"u2","name":"X"},"extra":{"new":1}}'));
    expect(bare.apps, {AppSection.customer});
  });

  test('TotpEnrolment exposes the secret from the otpauth URI', () {
    final e = TotpEnrolment.fromJson(j('{"totpURI":"otpauth://totp/Dabba%20Bela:sita?secret=JBSWY3DPEHPK3PXP&issuer=Dabba%20Bela","backupCodes":["a1b2","c3d4"]}'));
    expect(e.secret, 'JBSWY3DPEHPK3PXP');
    expect(e.backupCodes, hasLength(2));
  });

  test('MenuWeek with days, boxes, sold out, company menu', () {
    final w = MenuWeek.fromJson(j('''
{"weekStart":"2026-11-22","hasMenu":true,"kind":"STANDARD","isPast":false,"companyMenu":{"companyName":"Leapfrog","buildBlocked":true},
 "days":[{"date":"2026-11-23","weekday":"MON","label":"Mon 23","closed":false,"closure":null,"note":null,"orderable":true,"problem":null,"cutoff":"09:30","kind":"STANDARD",
   "items":[{"box":{"id":"b1","slug":"dal-bhat","name":"Dal Bhat Dabba","price":25000,"diet":"VEG","isVeg":true,"spice":2,
     "allergens":[{"code":"DAIRY","name":"Milk & dairy","mayContain":false}],"items":[{"name":"Rice","qty":1,"image":null}],"subs":[],"nutrition":{"kcal":620}},
     "isPrimary":true,"soldOut":false,"remaining":4,"replacement":null}]},
  {"date":"2026-11-24","weekday":"TUE","orderable":false,"problem":"Cut-off passed","cutoff":"09:30","items":[]}]}'''),);
    expect(w.companyMenuName, 'Leapfrog');
    expect(w.days, hasLength(2));
    final item = w.days.first.items.single;
    expect(item.box.price, 25000);
    expect(item.box.allergens.single.code, 'DAIRY');
    expect(item.remaining, 4);
    expect(item.box.nutrition['kcal'], 620);
    expect(w.days[1].problem, 'Cut-off passed');
  });

  test('PlanDetail with dayOptions map and slots', () {
    final d = PlanDetail.fromJson(j('''
{"plan":{"id":"p1","slug":"weekday","name":"Weekday Lunch","pricePerMeal":22000,"compareAtPrice":25000,"weeks":{"default":4,"min":1,"max":12},
  "minDaysPerWeek":3,"maxDaysPerWeek":6,"skipPolicy":"EXTEND","cancelPolicy":"CREDIT","policyText":{"skip":"Skipped meals move to the end.","cancel":"Unused meals become credit."}},
 "startDates":["2026-11-24","2026-11-25"],"dayOptions":{"2026-11-24":[{"boxId":"b1","name":"Dal Bhat","price":22000,"diet":"VEG","isVeg":true,"isPrimary":true,"soldOut":false}]},
 "slots":[{"id":"s1","label":"12:00–13:00","startTime":"12:00","endTime":"13:00"}],"paymentMethods":["ESEWA","KHALTI","WALLET"],"kitchenId":"k1"}'''),);
    expect(d.plan.weeksMax, 12);
    expect(d.plan.skipText, contains('end'));
    expect(d.dayOptions['2026-11-24']!.single.isPrimary, isTrue);
    expect(d.slots.single.label, '12:00–13:00');
  });

  test('CartQuote: lines with problems, totals, company share', () {
    final q = CartQuote.fromJson(j('''
{"ok":false,"error":null,"addressProblem":null,"lines":[{"key":"box:b1:2026-11-24:","kind":"box","id":"b1","date":"2026-11-24","qty":2,"subs":[],"name":"Dal Bhat",
 "unitPrice":25000,"diet":"VEG","allergens":["DAIRY"],"customizations":[],"problem":"Sold out for this day","warning":null}],
 "days":[],"subtotal":50000,"deliveryFee":0,"companyDiscount":10000,"couponDiscount":0,"tax":0,"taxInclusive":true,"total":40000,
 "companyShare":10000,"customerShare":30000,"couponCode":null,"couponError":"Coupon expired","company":{"name":"Leapfrog","billingMode":"SPLIT"},"kitchenId":"k1"}'''),);
    expect(q.ok, isFalse);
    expect(q.lines.single.problem, 'Sold out for this day');
    expect(q.customerShare, 30000);
    expect(q.companyName, 'Leapfrog');
    expect(q.couponError, 'Coupon expired');
  });

  test('PlaceOrderResult / SubscriptionPurchase → PurchaseResult', () {
    final r = PurchaseResult.fromJson(j('{"payment":{"id":"p1","reference":"PAY-1","method":"ESEWA","status":"PENDING","amount":30000,"purpose":"ORDER"},"orders":[{"id":"o1","number":"DB-1"}],"needsPayment":true,"next":"PAY"}'));
    expect(r.mustPay, isTrue);
    expect(r.orderIds, ['o1']);
    final s = PurchaseResult.fromJson(j('{"subscription":{"id":"s1","reference":"SUB-1","status":"ACTIVE"},"payment":{"id":"p2","method":"CASH","status":"PENDING","amount":1},"replayed":false,"needsPayment":false,"next":"DONE"}'));
    expect(s.mustPay, isFalse);
    expect(s.subscriptionId, 's1');
  });

  test('OrderDetail: actions, window, money, hand-off code', () {
    final o = OrderDetail.fromJson(j('''
{"id":"o1","number":"DB-1001","code":"K3","status":"OUT_FOR_DELIVERY","paymentStatus":"PAID","source":"SUBSCRIPTION","deliveryDate":"2026-11-24","slotLabel":"12–1",
 "deliveryOtp":"4821","delivery":{"contactName":"Sita","addressLine":"Tower 2","area":"Baneshwor"},
 "items":[{"id":"i1","name":"Dal Bhat","quantity":1,"unitPrice":22000,"lineTotal":22000,"components":[{"name":"Rice","qty":1}],"customizations":[{"label":"No onion"}]}],
 "money":{"subtotal":22000,"deliveryFee":0,"total":22000,"customerShare":22000,"taxInclusive":true},"payment":{"id":"p1","method":"WALLET","status":"PAID","amount":22000},
 "subscription":{"id":"s1","reference":"SUB-1","planName":"Weekday"},"refunds":[],"adjustments":[],"feedback":null,"window":{"open":false,"cutoff":"09:30"},
 "actions":{"cancel":false,"skip":false,"unskip":false,"swap":false,"feedback":false,"pay":false},"createdAt":"2026-11-20T06:15:00.000Z","deliveredAt":null}'''),);
    expect(o.isPlanMeal, isTrue);
    expect(o.deliveryOtp, '4821');
    expect(o.items.single.customizations, ['No onion']);
    expect(o.subscriptionPlanName, 'Weekday');
    expect(o.actions.cancel, isFalse);
    expect(o.createdAt!.isUtc, isTrue);
  });

  test('PaymentStart: eSewa form, Khalti URL, return-URL matching', () {
    final e = PaymentStart.fromJson(j('''
{"kind":"esewa","method":"POST","action":"https://rc-epay.esewa.com.np/api/epay/main/v2/form","fields":{"amount":"300","signature":"abc="},"url":null,
 "returnUrlPrefixes":["https://dabbabela.vercel.app/thank-you/","https://dabbabela.vercel.app/pay/","https://dabbabela.vercel.app/account/wallet/topup/"]}'''),);
    expect(e.fields['signature'], 'abc=');
    expect(e.isReturnUrl('https://dabbabela.vercel.app/thank-you/abc?data=x'), isTrue);
    expect(e.isReturnUrl('https://rc-epay.esewa.com.np/login'), isFalse);
    final k = PaymentStart.fromJson(j('{"kind":"khalti","method":"GET","action":null,"fields":null,"url":"https://test-pay.khalti.com/?pidx=1","returnUrlPrefixes":["/pay/"]}'));
    expect(k.url, contains('pidx'));
    expect(k.isReturnUrl('https://anyhost/pay/p1?status=Completed'), isTrue);
  });

  test('PaymentDetail: bank transfer and switchable methods', () {
    final p = PaymentDetail.fromJson(j('''
{"id":"p1","reference":"PAY-1","purpose":"ORDER","method":"BANK_TRANSFER","status":"PENDING","amount":30000,"refundedAmount":0,"paidAt":null,"createdAt":"2026-11-20T06:15:00.000Z",
 "expired":false,"proofSubmitted":false,"awaitingVerification":false,"lastAttempt":null,"orders":[],"subscription":null,"switchableMethods":["ESEWA","KHALTI","CASH"],
 "bankTransfer":{"bankDetails":"NIC Asia, A/C 123","qrImage":"/uploads/qr.png"}}'''),);
    expect(p.isOpen, isTrue);
    expect(p.isPaid, isFalse);
    expect(p.bankDetails, contains('NIC'));
    expect(p.switchableMethods, contains('CASH'));
  });

  test('PlanQuote, SubscriptionSummary, SubscriptionDetail', () {
    final q = PlanQuote.fromJson(j('{"ok":true,"meals":[{"date":"2026-11-24","name":"Dal Bhat","price":22000,"surcharge":0,"followsRotation":true,"problem":null}],"skippedDates":[],"closures":[{"date":"2026-11-28","name":"Tihar"}],"mealsTotal":20,"perMealEffective":22000,"subtotal":440000,"deliveryFee":0,"discount":0,"couponDiscount":0,"companyDiscount":0,"tax":0,"taxInclusive":true,"total":440000,"companyShare":0,"customerShare":440000,"savings":60000,"endDate":"2026-12-19"}'));
    expect(q.closures.single, contains('Tihar'));
    expect(q.savings, 60000);
    final s = SubscriptionSummary.fromJson(j('{"id":"s1","reference":"SUB-1","status":"ACTIVE","plan":{"id":"p1","name":"Weekday","slug":"weekday"},"startDate":"2026-11-24","endDate":"2026-12-19","days":["MON","TUE"],"mealsTotal":20,"mealsDelivered":5,"total":440000}'));
    expect(s.progress, 0.25);
    final d = SubscriptionDetail.fromJson(j('''
{"id":"s1","reference":"SUB-1","status":"ACTIVE","plan":{"id":"p1","name":"Weekday","slug":"weekday"},"startDate":"2026-11-24","endDate":"2026-12-19","days":["MON"],
 "address":{"id":"a1","label":"Office","type":"OFFICE","recipientName":"Sita","phone":"9800000000","line1":"Tower 2","area":"Baneshwor","city":"Kathmandu","covered":true,"zone":{"id":"z1","name":"Baneshwor"}},
 "policies":{"skip":"EXTEND","skipText":"Moves to the end.","cancel":"CREDIT","cancelText":"Credit."},
 "meals":[{"id":"o1","number":"DB-1","deliveryDate":"2026-11-24","status":"SCHEDULED","paymentStatus":"PAID","items":[{"name":"Dal Bhat","quantity":1}],"window":{"open":true,"cutoff":"09:30"},"deliveryOtp":null}],
 "pendingSwapPayments":[{"id":"p9","amount":3000}],"extraMeals":[],"changes":[]}'''),);
    expect(d.address!.zoneName, 'Baneshwor');
    expect(d.meals.single.windowOpen, isTrue);
    expect(d.pendingSwapPayments.single.integer('amount'), 3000);
  });

  test('Wallet (top-up off), ledger, notification, referrals, tickets', () {
    final w = Wallet.fromJson(j('{"balance":12500,"walletEnabled":true,"topup":{"enabled":false,"methods":[],"min":null,"max":null}}'));
    expect(w.balance, 12500);
    expect(w.topupEnabled, isFalse);
    expect(LedgerEntry.fromJson(j('{"id":"l1","amount":-2200,"reason":"ORDER_PAYMENT","reasonLabel":"Order payment","note":null,"createdAt":"2026-11-20T06:15:00.000Z"}')).amount, -2200);
    expect(AppNotification.fromJson(j('{"id":"n1","type":"ORDER","title":"On the way","readAt":null}')).unread, isTrue);
    final r = Referrals.fromJson(j('{"enabled":true,"code":"SITA50","shareText":"Try Dabba Bela","shareUrl":"https://x/r/SITA50","friends":[{"id":"f1","name":"Ram","status":"REWARDED"}],"rewarded":10000,"rewardCount":1,"canClaim":false}'));
    expect(r.friends.single.name, 'Ram');
    final t = TicketDetail.fromJson(j('{"id":"t1","number":"T-1","subject":"Late","status":"OPEN","canReply":true,"messages":[{"id":"m1","body":"Hi","fromMe":true,"author":"You"}]}'));
    expect(t.messages.single.fromMe, isTrue);
  });

  test('Address one-line summary and CartLine JSON', () {
    final a = Address.fromJson(j('{"id":"a1","placeName":"Leapfrog","line1":"Tower 2","area":"Baneshwor","ward":10,"municipality":"Kathmandu","city":"Kathmandu","covered":false,"zone":null}'));
    expect(a.oneLine, 'Leapfrog, Tower 2, Baneshwor, Ward 10, Kathmandu');
    expect(a.covered, isFalse);
    expect(const CartLine(kind: 'box', id: 'b1', date: '2026-11-24', qty: 2).toJson(), {'kind': 'box', 'id': 'b1', 'date': '2026-11-24', 'qty': 2});
  });
}
