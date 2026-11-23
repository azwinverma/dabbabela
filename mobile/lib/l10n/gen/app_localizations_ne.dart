// ignore: unused_import
import 'package:intl/intl.dart' as intl;
import 'app_localizations.dart';

// ignore_for_file: type=lint

/// The translations for Nepali (`ne`).
class AppLocalizationsNe extends AppLocalizations {
  AppLocalizationsNe([String locale = 'ne']) : super(locale);

  @override
  String get signIn => 'लग इन';

  @override
  String get signInTitle => 'फेरि स्वागत छ';

  @override
  String get signUp => 'खाता खोल्नुहोस्';

  @override
  String get signUpTitle => 'जहाँ भए पनि, समयमै खाना';

  @override
  String get haveAccount => 'खाता छ? लग इन गर्नुहोस्';

  @override
  String get noAccount => 'नयाँ हो? खाता खोल्नुहोस्';

  @override
  String get email => 'इमेल';

  @override
  String get password => 'पासवर्ड';

  @override
  String get newPassword => 'नयाँ पासवर्ड';

  @override
  String get name => 'पूरा नाम';

  @override
  String get phone => 'मोबाइल नम्बर';

  @override
  String get phoneHint => '९८XXXXXXXX';

  @override
  String get companyCode => 'कम्पनी कोड';

  @override
  String get referralCode => 'रेफरल कोड';

  @override
  String get showPassword => 'पासवर्ड देखाउनुहोस्';

  @override
  String get invalidEmail => 'सही इमेल लेख्नुहोस्';

  @override
  String get invalidPhone => 'नेपाली मोबाइल नम्बर लेख्नुहोस् (९८/९७/९६ + ८ अंक)';

  @override
  String get passwordTooShort => 'कम्तीमा ८ अक्षर';

  @override
  String get forgotPassword => 'पासवर्ड बिर्सनुभयो?';

  @override
  String get forgotTitle => 'पासवर्ड रिसेट गर्नुहोस्';

  @override
  String get forgotBody => 'हामी इमेलमा लिङ्क पठाउँछौँ। यही फोनमा खोल्नुहोस्, वा लिङ्कको कोड “मसँग रिसेट कोड छ” मा राख्नुहोस्।';

  @override
  String get sendLink => 'रिसेट लिङ्क पठाउनुहोस्';

  @override
  String get haveResetCode => 'मसँग रिसेट कोड छ';

  @override
  String get resetCode => 'रिसेट कोड (इमेल लिङ्कबाट)';

  @override
  String get setPassword => 'नयाँ पासवर्ड राख्नुहोस्';

  @override
  String get passwordReset => 'पासवर्ड बदलियो। नयाँ पासवर्डले लग इन गर्नुहोस्।';

  @override
  String get twoFactorTitle => 'अथेन्टिकेटर कोड लेख्नुहोस्';

  @override
  String get twoFactorBody => 'अथेन्टिकेटर एप खोलेर डब्बा बेलाको ६ अंकको कोड लेख्नुहोस्।';

  @override
  String get code => 'कोड';

  @override
  String get verify => 'पुष्टि गर्नुहोस्';

  @override
  String get useBackupCode => 'ब्याकअप कोड प्रयोग गर्नुहोस्';

  @override
  String get useAuthenticator => 'अथेन्टिकेटर एप प्रयोग गर्नुहोस्';

  @override
  String get backupCode => 'ब्याकअप कोड';

  @override
  String get challengeExpired => 'लग इनको समय सकियो। फेरि लग इन गर्नुहोस्।';

  @override
  String get phoneSignIn => 'SMS कोडबाट लग इन';

  @override
  String get sendCode => 'कोड पठाउनुहोस्';

  @override
  String codeSent(Object phone) {
    return '$phone मा कोड पठायौँ';
  }

  @override
  String get resendCode => 'नयाँ कोड पठाउनुहोस्';

  @override
  String get enrolTitle => 'दुई-चरण लग इन सेटअप';

  @override
  String get enrolIntro => 'स्टाफ खातामा अथेन्टिकेटर एप चाहिन्छ। सुरु गर्न पासवर्ड पुष्टि गर्नुहोस्।';

  @override
  String get enrolScan => 'अथेन्टिकेटर एपले यो QR स्क्यान गर्नुहोस्, वा कि हातैले लेख्नुहोस्।';

  @override
  String get enrolSecret => 'सेटअप कि';

  @override
  String get backupCodesTitle => 'ब्याकअप कोड';

  @override
  String get backupCodesBody => 'यी सुरक्षित ठाउँमा राख्नुहोस्। फोन हरायो भने प्रत्येक एक पटक चल्छ। फेरि देखाइँदैन।';

  @override
  String get enrolConfirm => 'सक्न एपको ६ अंकको कोड लेख्नुहोस्';

  @override
  String get enrolDone => 'दुई-चरण लग इन सक्रिय भयो।';

  @override
  String get twoFactorOn => 'यो खातामा दुई-चरण लग इन सक्रिय छ।';

  @override
  String get sessionsTitle => 'लग इन भएका उपकरण';

  @override
  String get thisDevice => 'यो उपकरण';

  @override
  String get signOutOthers => 'अरू सबै उपकरणबाट लग आउट';

  @override
  String get revoke => 'लग आउट';

  @override
  String lastActive(Object when) {
    return 'पछिल्लो पटक $when';
  }

  @override
  String get maintenance => 'मर्मत भइरहेको छ';

  @override
  String get appName => 'डब्बा बेला';

  @override
  String get tagline => 'घरको स्वाद, हरेक दिउँसो।';

  @override
  String get retry => 'फेरि प्रयास गर्नुहोस्';

  @override
  String get loading => 'लोड हुँदैछ…';

  @override
  String get save => 'सेभ गर्नुहोस्';

  @override
  String get cancel => 'रद्द';

  @override
  String get close => 'बन्द गर्नुहोस्';

  @override
  String get confirm => 'पक्का गर्नुहोस्';

  @override
  String get continueLabel => 'अगाडि बढ्नुहोस्';

  @override
  String get back => 'पछाडि';

  @override
  String get edit => 'सम्पादन';

  @override
  String get delete => 'मेटाउनुहोस्';

  @override
  String get add => 'थप्नुहोस्';

  @override
  String get done => 'भयो';

  @override
  String get yes => 'हो';

  @override
  String get no => 'होइन';

  @override
  String get optional => 'ऐच्छिक';

  @override
  String get required => 'अनिवार्य';

  @override
  String get today => 'आज';

  @override
  String get tomorrow => 'भोलि';

  @override
  String get total => 'जम्मा';

  @override
  String get subtotal => 'उप-जम्मा';

  @override
  String get deliveryFee => 'डेलिभरी';

  @override
  String get discount => 'छुट';

  @override
  String get tax => 'भ्याट';

  @override
  String get free => 'निःशुल्क';

  @override
  String get nothingHere => 'अहिलेसम्म केही छैन';

  @override
  String get pullToRefresh => 'ताजा गर्न तल तान्नुहोस्';

  @override
  String get errorTitle => 'यो लोड हुन सकेन';

  @override
  String get offlineTitle => 'इन्टरनेट छैन';

  @override
  String get offlineBody => 'इन्टरनेट जाँचेर फेरि प्रयास गर्नुहोस्। केही हराएको छैन।';

  @override
  String get noPermission => 'तपाईंको खातामा यसको अनुमति छैन।';

  @override
  String get loadMore => 'थप हेर्नुहोस्';

  @override
  String get saved => 'सेभ भयो';

  @override
  String get date => 'मिति';

  @override
  String get pickDate => 'मिति छान्नुहोस्';

  @override
  String get reason => 'कारण';

  @override
  String get note => 'टिप्पणी';

  @override
  String get status => 'अवस्था';

  @override
  String get switchApp => 'एप बदल्नुहोस्';

  @override
  String get chooseApp => 'कहाँ जान चाहनुहुन्छ?';

  @override
  String get appCustomer => 'खाना अर्डर';

  @override
  String get appCustomerHint => 'मेनु, खाना योजना, तपाईंका अर्डर';

  @override
  String get appRider => 'राइडर';

  @override
  String get appRiderHint => 'आजका रुट र डेलिभरी';

  @override
  String get appKitchen => 'भान्सा';

  @override
  String get appKitchenHint => 'उत्पादन, प्याकिङ, गुणस्तर';

  @override
  String get appDispatcher => 'डिस्प्याच';

  @override
  String get appDispatcherHint => 'बोर्ड, रुट, राइडर, असफल डेलिभरी';

  @override
  String get signOut => 'लग आउट';

  @override
  String get signOutConfirm => 'यो फोनबाट लग आउट गर्ने?';

  @override
  String get language => 'भाषा';

  @override
  String get languageEnglish => 'English';

  @override
  String get languageNepali => 'नेपाली';

  @override
  String get kitchen => 'भान्सा';

  @override
  String get pickKitchen => 'भान्सा छान्नुहोस्';

  @override
  String get noKitchens => 'तपाईंको दायरामा कुनै भान्सा छैन। एडमिनलाई थप्न भन्नुहोस्।';

  @override
  String get twoFactorSetupBanner => 'स्टाफ खण्ड खोल्न अथेन्टिकेटर एप सेटअप गर्नुहोस्।';

  @override
  String get setUpNow => 'अहिले सेटअप गर्नुहोस्';

  @override
  String get call => 'फोन गर्नुहोस्';

  @override
  String get navigate => 'बाटो हेर्नुहोस्';

  @override
  String get share => 'सेयर';

  @override
  String get copy => 'कपी';

  @override
  String get copied => 'कपी भयो';

  @override
  String get selectAll => 'सबै छान्नुहोस्';

  @override
  String selectedCount(int count) {
    return '$count छानियो';
  }

  @override
  String meals(int count) {
    return '$count खाना';
  }

  @override
  String orderCount(int count) {
    return '$count अर्डर';
  }

  @override
  String get riderRoutesTitle => 'मेरा रुट';

  @override
  String get riderNoRoutes => 'यो दिन कुनै रुट छैन।';

  @override
  String riderStopsProgress(int done, int total) {
    return '$total मध्ये $done स्टप सकियो';
  }

  @override
  String riderCashCollected(Object amount) {
    return 'उठेको नगद: $amount';
  }

  @override
  String get riderReadOnly => 'हेर्न मात्र — यहाँबाट यो रुट बदल्न मिल्दैन।';

  @override
  String riderRouteCount(int count) {
    return '$count रुट';
  }

  @override
  String riderStop(int n) {
    return 'स्टप $n';
  }

  @override
  String get riderDeliver => 'पुर्‍याइयो';

  @override
  String get riderFail => 'पुर्‍याउन सकिएन';

  @override
  String get riderFinishRoute => 'रुट सक्नुहोस्';

  @override
  String get riderFinishConfirm => 'यो रुट सक्ने? सबै स्टप पुर्‍याइएको वा असफल चिनो लगाइएको छ भनी जाँच्नुहोस्।';

  @override
  String get riderRouteFinished => 'रुट सकियो।';

  @override
  String riderOpenStops(int count) {
    return '$count स्टप बाँकी';
  }

  @override
  String riderDeliverTitle(Object number) {
    return '$number पुर्‍याइएको चिनो';
  }

  @override
  String get riderOtpLabel => 'ग्राहकको ४ अंकको कोड';

  @override
  String get riderOtpHelp => 'ग्राहकको एप वा SMS मा देखिएको कोड सोध्नुहोस्।';

  @override
  String get riderOtpInvalid => '४ अंकको कोड लेख्नुहोस्';

  @override
  String riderCollect(Object amount) {
    return '$amount नगद लिनुहोस्';
  }

  @override
  String get riderCashLabel => 'लिएको नगद (रु)';

  @override
  String riderCashMismatch(Object amount) {
    return 'ठ्याक्कै $amount हुनुपर्छ';
  }

  @override
  String get riderPhoto => 'डेलिभरी फोटो';

  @override
  String get riderPhotoRequired => 'पुर्‍याइएको डब्बाको फोटो चाहिन्छ।';

  @override
  String get riderTakePhoto => 'फोटो खिच्नुहोस्';

  @override
  String get riderChoosePhoto => 'फोटो छान्नुहोस्';

  @override
  String get riderRemovePhoto => 'फोटो हटाउनुहोस्';

  @override
  String riderDelivered(Object number) {
    return '$number पुर्‍याइयो।';
  }

  @override
  String get riderFailTitle => 'किन पुर्‍याउन सकिएन?';

  @override
  String get riderFailDetail => 'के भयो?';

  @override
  String riderFailed(Object number) {
    return '$number असफल चिनो लगाइयो।';
  }

  @override
  String get riderAllergen => 'एलर्जी टिप्पणी';

  @override
  String get riderInstructions => 'निर्देशन';

  @override
  String get riderPrepaid => 'भुक्तानी भइसक्यो — केही लिनु पर्दैन';

  @override
  String get riderCantOpen => 'यो फोनमा त्यो एप खुलेन।';

  @override
  String get kitchenProduction => 'उत्पादन';

  @override
  String get kitchenBatches => 'ब्याच';

  @override
  String get kitchenQc => 'गुणस्तर लग';

  @override
  String get kitchenAlerts => 'स्टक सूचना';

  @override
  String get kitchenOrders => 'अर्डर';

  @override
  String get kitchenMeals => 'खाना';

  @override
  String get kitchenPendingPayment => 'भुक्तानी बाँकी';

  @override
  String get kitchenAllergenFlagged => 'एलर्जी चिनो';

  @override
  String get kitchenByDabba => 'डब्बा अनुसार';

  @override
  String get kitchenBySlot => 'डेलिभरी समय अनुसार';

  @override
  String get kitchenDishes => 'पकाउने परिकार';

  @override
  String kitchenPortions(int portions, int buffer, int total) {
    return '$portions + $buffer बफर = $total';
  }

  @override
  String get kitchenStartPreparing => 'पकाउन सुरु';

  @override
  String get kitchenPack => 'प्याक';

  @override
  String get kitchenPackChecksTitle => 'प्याकिङ जाँच';

  @override
  String get kitchenPackChecksBody => 'छानिएका हरेक अर्डरका लागि पुष्टि गर्नुहोस्:';

  @override
  String get kitchenCheckItems => 'सामान टिकटसँग मिल्छ';

  @override
  String get kitchenCheckLabel => 'डब्बामा लेबल छ';

  @override
  String get kitchenCheckAllergen => 'एलर्जी टिप्पणी पालना भयो';

  @override
  String get kitchenCheckSealed => 'सिल गरियो';

  @override
  String kitchenChanged(int count) {
    return '$count अर्डर अद्यावधिक भयो';
  }

  @override
  String get kitchenRejected => 'बदलिएन:';

  @override
  String get kitchenSelectOrders => 'एकैपटक काम गर्न अर्डर छान्नुहोस्।';

  @override
  String get kitchenNoOrders => 'यो भान्सा-दिनका लागि अर्डर छैन।';

  @override
  String get kitchenPlanBatches => 'पूर्वानुमानबाट ब्याच योजना';

  @override
  String kitchenPlanned(int created, int updated) {
    return '$created नयाँ, $updated अद्यावधिक';
  }

  @override
  String get kitchenNoBatches => 'अहिलेसम्म ब्याच छैन। पूर्वानुमानबाट योजना बनाउनुहोस्।';

  @override
  String kitchenBatchPortions(int planned, int buffer) {
    return '$planned योजना (+$buffer बफर)';
  }

  @override
  String get kitchenStartCooking => 'पकाउन सुरु';

  @override
  String get kitchenMarkDone => 'सकियो चिनो';

  @override
  String get kitchenCancelBatch => 'ब्याच रद्द';

  @override
  String get kitchenActualPortions => 'वास्तविक भाग';

  @override
  String get kitchenWastePortions => 'खेर गएको भाग';

  @override
  String get kitchenShortages => 'स्टक कमी';

  @override
  String get kitchenLogQc => 'जाँच दर्ता';

  @override
  String get kitchenQcType => 'जाँच';

  @override
  String get kitchenQcValue => 'मान (जस्तै 68°C)';

  @override
  String get kitchenQcPass => 'पास';

  @override
  String get kitchenQcFail => 'फेल';

  @override
  String get kitchenQcNoteRequired => 'फेल जाँचमा टिप्पणी चाहिन्छ।';

  @override
  String get kitchenNoQc => 'यो दिन कुनै जाँच दर्ता छैन।';

  @override
  String get kitchenNoAlerts => 'स्टक सूचना छैन। सबै ठिक छ।';

  @override
  String get qcTEMPERATURE => 'तापक्रम';

  @override
  String get qcTASTE => 'स्वाद';

  @override
  String get qcHYGIENE => 'सरसफाइ';

  @override
  String get qcPACKAGING => 'प्याकेजिङ';

  @override
  String get qcOTHER => 'अन्य';

  @override
  String get dispatchBoard => 'बोर्ड';

  @override
  String get dispatchRoutes => 'रुट';

  @override
  String get dispatchFailed => 'असफल';

  @override
  String get dispatchHandOffPoints => 'हस्तान्तरण स्थान';

  @override
  String get dispatchUnrouted => 'रुट नभएका';

  @override
  String get dispatchOut => 'बाहिर';

  @override
  String get dispatchChanged => 'रुटपछि बदलिएका';

  @override
  String get dispatchManifest => 'म्यानिफेस्ट (समय × क्षेत्र)';

  @override
  String get dispatchUnroutedOrders => 'रुट नभएका अर्डर';

  @override
  String get dispatchAllRouted => 'सबै अर्डर रुटमा छन्।';

  @override
  String get dispatchCreateRoute => 'नयाँ रुट';

  @override
  String get dispatchAddToRoute => 'रुटमा थप्नुहोस्';

  @override
  String get dispatchAutoGroup => 'स्वतः समूह';

  @override
  String get dispatchAutoGroupConfirm => 'रुट नभएका सबै अर्डरलाई समय × क्षेत्र अनुसार एक-एक रुटमा राख्ने?';

  @override
  String dispatchAutoGrouped(int routes, int stops) {
    return '$routes रुट, $stops स्टप';
  }

  @override
  String get dispatchRouteName => 'रुटको नाम';

  @override
  String get dispatchSlot => 'डेलिभरी समय';

  @override
  String get dispatchZone => 'क्षेत्र';

  @override
  String get dispatchRider => 'राइडर';

  @override
  String get dispatchNone => 'कुनै होइन';

  @override
  String get dispatchNoRider => 'राइडर छैन';

  @override
  String get dispatchAssignRider => 'राइडर तोक्नुहोस्';

  @override
  String get dispatchUnavailable => 'व्यस्त';

  @override
  String get dispatchStart => 'पठाउनुहोस्';

  @override
  String get dispatchComplete => 'रुट बन्द';

  @override
  String dispatchStarted(int out, int notPacked) {
    return '$out डेलिभरीमा, $notPacked प्याक बाँकी';
  }

  @override
  String get dispatchRemoveStop => 'रुटबाट हटाउनुहोस्';

  @override
  String get dispatchNoRoutes => 'यो दिनका लागि रुट छैन।';

  @override
  String dispatchCashExpected(Object collected, Object expected) {
    return 'नगद $expected मध्ये $collected';
  }

  @override
  String get dispatchNoFailed => 'यो दिन कुनै असफल डेलिभरी छैन।';

  @override
  String get dispatchRetry => 'फेरि पठाउनुहोस्';

  @override
  String get dispatchCancelCredit => 'रद्द + क्रेडिट';

  @override
  String get dispatchCancelCreditBody => 'यो अर्डर रद्द गरी ग्राहकको वालेटमा क्रेडिट दिनुहोस्।';

  @override
  String dispatchResolved(Object number) {
    return '$number अद्यावधिक भयो।';
  }

  @override
  String get dispatchPickRoute => 'रुट छान्नुहोस्';

  @override
  String dispatchFailedReason(Object reason) {
    return 'पछिल्लो कारण: $reason';
  }

  @override
  String get stPENDING_PAYMENT => 'भुक्तानी बाँकी';

  @override
  String get stSCHEDULED => 'तय भयो';

  @override
  String get stCONFIRMED => 'पक्का भयो';

  @override
  String get stPREPARING => 'भान्सामा';

  @override
  String get stPACKED => 'प्याक भयो';

  @override
  String get stOUT_FOR_DELIVERY => 'बाटोमा';

  @override
  String get stDELIVERED => 'पुग्यो';

  @override
  String get stFAILED_DELIVERY => 'डेलिभरी हुन सकेन';

  @override
  String get stCANCELLED => 'रद्द';

  @override
  String get stSKIPPED => 'छोडियो';

  @override
  String get stPENDING => 'बाँकी';

  @override
  String get stPAID => 'भुक्तानी भयो';

  @override
  String get stFAILED => 'असफल';

  @override
  String get stREFUNDED => 'फिर्ता भयो';

  @override
  String get stPARTIALLY_REFUNDED => 'आंशिक फिर्ता';

  @override
  String get stACTIVE => 'सक्रिय';

  @override
  String get stPAUSED => 'रोकिएको';

  @override
  String get stCOMPLETED => 'सकियो';

  @override
  String get stPLANNED => 'योजना';

  @override
  String get stOUT => 'बाहिर';

  @override
  String get stDONE => 'सकियो';

  @override
  String get stCOOKING => 'पाक्दैछ';

  @override
  String get stOPEN => 'खुला';

  @override
  String get stRESOLVED => 'समाधान भयो';

  @override
  String get stCLOSED => 'बन्द';

  @override
  String get stREJECTED => 'अस्वीकृत';

  @override
  String get pmESEWA => 'इसेवा';

  @override
  String get pmKHALTI => 'खल्ती';

  @override
  String get pmBANK_TRANSFER => 'बैंक ट्रान्सफर / QR';

  @override
  String get pmCASH => 'डेलिभरीमा नगद';

  @override
  String get pmCOMPANY_INVOICE => 'कम्पनी बिल';

  @override
  String get pmWALLET => 'डब्बा क्रेडिट';

  @override
  String get daySUN => 'आइत';

  @override
  String get dayMON => 'सोम';

  @override
  String get dayTUE => 'मङ्गल';

  @override
  String get dayWED => 'बुध';

  @override
  String get dayTHU => 'बिही';

  @override
  String get dayFRI => 'शुक्र';

  @override
  String get daySAT => 'शनि';

  @override
  String get dietVEG => 'शाकाहारी';

  @override
  String get dietVEGAN => 'भेगन';

  @override
  String get dietEGG => 'अण्डा सहित';

  @override
  String get dietNONVEG => 'मासु';
}
