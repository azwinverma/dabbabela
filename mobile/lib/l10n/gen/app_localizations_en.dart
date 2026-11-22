// ignore: unused_import
import 'package:intl/intl.dart' as intl;
import 'app_localizations.dart';

// ignore_for_file: type=lint

/// The translations for English (`en`).
class AppLocalizationsEn extends AppLocalizations {
  AppLocalizationsEn([String locale = 'en']) : super(locale);

  @override
  String get appName => 'Dabba Bela';

  @override
  String get tagline => 'Your lunch. Your way. Ghar ko swad.';

  @override
  String get retry => 'Try again';

  @override
  String get loading => 'Loading…';

  @override
  String get save => 'Save';

  @override
  String get cancel => 'Cancel';

  @override
  String get close => 'Close';

  @override
  String get confirm => 'Confirm';

  @override
  String get continueLabel => 'Continue';

  @override
  String get back => 'Back';

  @override
  String get edit => 'Edit';

  @override
  String get delete => 'Delete';

  @override
  String get add => 'Add';

  @override
  String get done => 'Done';

  @override
  String get yes => 'Yes';

  @override
  String get no => 'No';

  @override
  String get optional => 'Optional';

  @override
  String get required => 'Required';

  @override
  String get today => 'Today';

  @override
  String get tomorrow => 'Tomorrow';

  @override
  String get total => 'Total';

  @override
  String get subtotal => 'Subtotal';

  @override
  String get deliveryFee => 'Delivery';

  @override
  String get discount => 'Discount';

  @override
  String get tax => 'VAT';

  @override
  String get free => 'Free';

  @override
  String get nothingHere => 'Nothing here yet';

  @override
  String get pullToRefresh => 'Pull down to refresh';

  @override
  String get errorTitle => 'Couldn\'t load this';

  @override
  String get offlineTitle => 'You\'re offline';

  @override
  String get offlineBody => 'Check your connection and try again. Nothing was lost.';

  @override
  String get noPermission => 'Your account doesn\'t have access to this.';

  @override
  String get loadMore => 'Load more';

  @override
  String get saved => 'Saved';

  @override
  String get date => 'Date';

  @override
  String get pickDate => 'Pick a date';

  @override
  String get reason => 'Reason';

  @override
  String get note => 'Note';

  @override
  String get status => 'Status';

  @override
  String get switchApp => 'Switch app';

  @override
  String get chooseApp => 'Where do you want to go?';

  @override
  String get appCustomer => 'Order lunch';

  @override
  String get appCustomerHint => 'Menu, meal plans, your orders';

  @override
  String get appRider => 'Rider';

  @override
  String get appRiderHint => 'Today\'s routes and deliveries';

  @override
  String get appKitchen => 'Kitchen';

  @override
  String get appKitchenHint => 'Production, packing, QC';

  @override
  String get appDispatcher => 'Dispatch';

  @override
  String get appDispatcherHint => 'Board, routes, riders, failed deliveries';

  @override
  String get signOut => 'Sign out';

  @override
  String get signOutConfirm => 'Sign out of Dabba Bela on this phone?';

  @override
  String get language => 'Language';

  @override
  String get languageEnglish => 'English';

  @override
  String get languageNepali => 'नेपाली';

  @override
  String get kitchen => 'Kitchen';

  @override
  String get pickKitchen => 'Choose a kitchen';

  @override
  String get noKitchens => 'No kitchens are in your scope. Ask an admin to add you to one.';

  @override
  String get twoFactorSetupBanner => 'Set up your authenticator app to open the staff sections.';

  @override
  String get setUpNow => 'Set up now';

  @override
  String get call => 'Call';

  @override
  String get navigate => 'Navigate';

  @override
  String get share => 'Share';

  @override
  String get copy => 'Copy';

  @override
  String get copied => 'Copied';

  @override
  String get selectAll => 'Select all';

  @override
  String selectedCount(int count) {
    return '$count selected';
  }

  @override
  String meals(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count meals',
      one: '1 meal',
    );
    return '$_temp0';
  }

  @override
  String orderCount(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count orders',
      one: '1 order',
    );
    return '$_temp0';
  }

  @override
  String get stPENDING_PAYMENT => 'Payment pending';

  @override
  String get stSCHEDULED => 'Scheduled';

  @override
  String get stCONFIRMED => 'Confirmed';

  @override
  String get stPREPARING => 'In the kitchen';

  @override
  String get stPACKED => 'Packed';

  @override
  String get stOUT_FOR_DELIVERY => 'On the way';

  @override
  String get stDELIVERED => 'Delivered';

  @override
  String get stFAILED_DELIVERY => 'Delivery failed';

  @override
  String get stCANCELLED => 'Cancelled';

  @override
  String get stSKIPPED => 'Skipped';

  @override
  String get stPENDING => 'Pending';

  @override
  String get stPAID => 'Paid';

  @override
  String get stFAILED => 'Failed';

  @override
  String get stREFUNDED => 'Refunded';

  @override
  String get stPARTIALLY_REFUNDED => 'Partly refunded';

  @override
  String get stACTIVE => 'Active';

  @override
  String get stPAUSED => 'Paused';

  @override
  String get stCOMPLETED => 'Completed';

  @override
  String get stPLANNED => 'Planned';

  @override
  String get stOUT => 'Out';

  @override
  String get stDONE => 'Done';

  @override
  String get stCOOKING => 'Cooking';

  @override
  String get stOPEN => 'Open';

  @override
  String get stRESOLVED => 'Resolved';

  @override
  String get stCLOSED => 'Closed';

  @override
  String get stREJECTED => 'Rejected';

  @override
  String get pmESEWA => 'eSewa';

  @override
  String get pmKHALTI => 'Khalti';

  @override
  String get pmBANK_TRANSFER => 'Bank transfer / QR';

  @override
  String get pmCASH => 'Cash on delivery';

  @override
  String get pmCOMPANY_INVOICE => 'Company invoice';

  @override
  String get pmWALLET => 'Dabba credit';

  @override
  String get daySUN => 'Sun';

  @override
  String get dayMON => 'Mon';

  @override
  String get dayTUE => 'Tue';

  @override
  String get dayWED => 'Wed';

  @override
  String get dayTHU => 'Thu';

  @override
  String get dayFRI => 'Fri';

  @override
  String get daySAT => 'Sat';

  @override
  String get dietVEG => 'Veg';

  @override
  String get dietVEGAN => 'Vegan';

  @override
  String get dietEGG => 'Egg';

  @override
  String get dietNONVEG => 'Non-veg';
}
