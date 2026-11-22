// ignore: unused_import
import 'package:intl/intl.dart' as intl;
import 'app_localizations.dart';

// ignore_for_file: type=lint

/// The translations for Nepali (`ne`).
class AppLocalizationsNe extends AppLocalizations {
  AppLocalizationsNe([String locale = 'ne']) : super(locale);

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
