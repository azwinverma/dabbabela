// ignore: unused_import
import 'package:intl/intl.dart' as intl;
import 'app_localizations.dart';

// ignore_for_file: type=lint

/// The translations for English (`en`).
class AppLocalizationsEn extends AppLocalizations {
  AppLocalizationsEn([String locale = 'en']) : super(locale);

  @override
  String get signIn => 'Sign in';

  @override
  String get signInTitle => 'Welcome back';

  @override
  String get signUp => 'Create account';

  @override
  String get signUpTitle => 'Lunch, on time, wherever you are';

  @override
  String get haveAccount => 'Already have an account? Sign in';

  @override
  String get noAccount => 'New here? Create an account';

  @override
  String get email => 'Email';

  @override
  String get password => 'Password';

  @override
  String get newPassword => 'New password';

  @override
  String get name => 'Full name';

  @override
  String get phone => 'Mobile number';

  @override
  String get phoneHint => '98XXXXXXXX';

  @override
  String get companyCode => 'Company code';

  @override
  String get referralCode => 'Referral code';

  @override
  String get showPassword => 'Show password';

  @override
  String get invalidEmail => 'Enter a valid email';

  @override
  String get invalidPhone => 'Enter a Nepal mobile number (98/97/96 + 8 digits)';

  @override
  String get passwordTooShort => 'At least 8 characters';

  @override
  String get forgotPassword => 'Forgot password?';

  @override
  String get forgotTitle => 'Reset your password';

  @override
  String get forgotBody => 'We\'ll email you a link. Open it on this phone, or copy the code from the link into “I have a reset code”.';

  @override
  String get sendLink => 'Send reset link';

  @override
  String get haveResetCode => 'I have a reset code';

  @override
  String get resetCode => 'Reset code (from the email link)';

  @override
  String get setPassword => 'Set new password';

  @override
  String get passwordReset => 'Password changed. Sign in with the new one.';

  @override
  String get twoFactorTitle => 'Enter your authenticator code';

  @override
  String get twoFactorBody => 'Open your authenticator app and type the 6-digit code for Dabba Bela.';

  @override
  String get code => 'Code';

  @override
  String get verify => 'Verify';

  @override
  String get useBackupCode => 'Use a backup code instead';

  @override
  String get useAuthenticator => 'Use the authenticator app';

  @override
  String get backupCode => 'Backup code';

  @override
  String get challengeExpired => 'That sign-in expired. Please sign in again.';

  @override
  String get phoneSignIn => 'Sign in with an SMS code';

  @override
  String get sendCode => 'Send code';

  @override
  String codeSent(Object phone) {
    return 'We sent a code to $phone';
  }

  @override
  String get resendCode => 'Send a new code';

  @override
  String get enrolTitle => 'Set up two-step sign-in';

  @override
  String get enrolIntro => 'Staff accounts need an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password…). Confirm your password to start.';

  @override
  String get enrolScan => 'Scan this QR code with your authenticator app, or enter the key by hand.';

  @override
  String get enrolSecret => 'Setup key';

  @override
  String get backupCodesTitle => 'Backup codes';

  @override
  String get backupCodesBody => 'Save these somewhere safe. Each works once if you lose your phone. They won\'t be shown again.';

  @override
  String get enrolConfirm => 'Enter the 6-digit code from the app to finish';

  @override
  String get enrolDone => 'Two-step sign-in is on.';

  @override
  String get twoFactorOn => 'Two-step sign-in is on for this account.';

  @override
  String get sessionsTitle => 'Signed-in devices';

  @override
  String get thisDevice => 'This device';

  @override
  String get signOutOthers => 'Sign out all other devices';

  @override
  String get revoke => 'Sign out';

  @override
  String lastActive(Object when) {
    return 'Last active $when';
  }

  @override
  String get maintenance => 'We\'re doing some maintenance';

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
  String get riderRoutesTitle => 'My routes';

  @override
  String get riderNoRoutes => 'No routes for this day.';

  @override
  String riderStopsProgress(int done, int total) {
    return '$done of $total stops done';
  }

  @override
  String riderCashCollected(Object amount) {
    return 'Cash collected: $amount';
  }

  @override
  String get riderReadOnly => 'View only — this route can\'t be changed from here.';

  @override
  String riderRouteCount(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count routes',
      one: '1 route',
      zero: 'No routes',
    );
    return '$_temp0';
  }

  @override
  String riderStop(int n) {
    return 'Stop $n';
  }

  @override
  String get riderDeliver => 'Delivered';

  @override
  String get riderFail => 'Couldn\'t deliver';

  @override
  String get riderFinishRoute => 'Finish route';

  @override
  String get riderFinishConfirm => 'Finish this route? Make sure every stop is delivered or marked failed.';

  @override
  String get riderRouteFinished => 'Route finished.';

  @override
  String riderOpenStops(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count stops still out',
      one: '1 stop still out',
    );
    return '$_temp0';
  }

  @override
  String riderDeliverTitle(Object number) {
    return 'Mark $number delivered';
  }

  @override
  String get riderOtpLabel => 'Customer\'s 4-digit code';

  @override
  String get riderOtpHelp => 'Ask the customer for the code shown in their app or SMS.';

  @override
  String get riderOtpInvalid => 'Enter the 4-digit code';

  @override
  String riderCollect(Object amount) {
    return 'Collect $amount in cash';
  }

  @override
  String get riderCashLabel => 'Cash collected (Rs)';

  @override
  String riderCashMismatch(Object amount) {
    return 'Must be exactly $amount';
  }

  @override
  String get riderPhoto => 'Delivery photo';

  @override
  String get riderPhotoRequired => 'A photo of the delivered dabba is required.';

  @override
  String get riderTakePhoto => 'Take photo';

  @override
  String get riderChoosePhoto => 'Choose photo';

  @override
  String get riderRemovePhoto => 'Remove photo';

  @override
  String riderDelivered(Object number) {
    return '$number delivered.';
  }

  @override
  String get riderFailTitle => 'Why couldn\'t you deliver?';

  @override
  String get riderFailDetail => 'What happened?';

  @override
  String riderFailed(Object number) {
    return '$number marked failed.';
  }

  @override
  String get riderAllergen => 'Allergy note';

  @override
  String get riderInstructions => 'Instructions';

  @override
  String get riderPrepaid => 'Paid — nothing to collect';

  @override
  String get riderCantOpen => 'Couldn\'t open that app on this phone.';

  @override
  String get kitchenProduction => 'Production';

  @override
  String get kitchenBatches => 'Batches';

  @override
  String get kitchenQc => 'QC log';

  @override
  String get kitchenAlerts => 'Stock alerts';

  @override
  String get kitchenOrders => 'Orders';

  @override
  String get kitchenMeals => 'Meals';

  @override
  String get kitchenPendingPayment => 'Payment pending';

  @override
  String get kitchenAllergenFlagged => 'Allergy flags';

  @override
  String get kitchenByDabba => 'By dabba';

  @override
  String get kitchenBySlot => 'By delivery slot';

  @override
  String get kitchenDishes => 'Dishes to cook';

  @override
  String kitchenPortions(int portions, int buffer, int total) {
    return '$portions + $buffer buffer = $total';
  }

  @override
  String get kitchenStartPreparing => 'Start preparing';

  @override
  String get kitchenPack => 'Pack';

  @override
  String get kitchenPackChecksTitle => 'Packing checks';

  @override
  String get kitchenPackChecksBody => 'Confirm for each selected order:';

  @override
  String get kitchenCheckItems => 'Items match the ticket';

  @override
  String get kitchenCheckLabel => 'Label is on the dabba';

  @override
  String get kitchenCheckAllergen => 'Allergy notes respected';

  @override
  String get kitchenCheckSealed => 'Sealed';

  @override
  String kitchenChanged(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count orders updated',
      one: '1 order updated',
    );
    return '$_temp0';
  }

  @override
  String get kitchenRejected => 'Not changed:';

  @override
  String get kitchenSelectOrders => 'Select orders to act on them in bulk.';

  @override
  String get kitchenNoOrders => 'No orders for this kitchen-day.';

  @override
  String get kitchenPlanBatches => 'Plan batches from forecast';

  @override
  String kitchenPlanned(int created, int updated) {
    return '$created created, $updated updated';
  }

  @override
  String get kitchenNoBatches => 'No batches yet. Plan them from the forecast.';

  @override
  String kitchenBatchPortions(int planned, int buffer) {
    return '$planned planned (+$buffer buffer)';
  }

  @override
  String get kitchenStartCooking => 'Start cooking';

  @override
  String get kitchenMarkDone => 'Mark done';

  @override
  String get kitchenCancelBatch => 'Cancel batch';

  @override
  String get kitchenActualPortions => 'Actual portions';

  @override
  String get kitchenWastePortions => 'Wasted portions';

  @override
  String get kitchenShortages => 'Stock shortages';

  @override
  String get kitchenLogQc => 'Log a check';

  @override
  String get kitchenQcType => 'Check';

  @override
  String get kitchenQcValue => 'Reading (e.g. 68°C)';

  @override
  String get kitchenQcPass => 'Pass';

  @override
  String get kitchenQcFail => 'Fail';

  @override
  String get kitchenQcNoteRequired => 'A failed check needs a note.';

  @override
  String get kitchenNoQc => 'No checks logged for this day.';

  @override
  String get kitchenNoAlerts => 'No stock alerts. All good.';

  @override
  String get qcTEMPERATURE => 'Temperature';

  @override
  String get qcTASTE => 'Taste';

  @override
  String get qcHYGIENE => 'Hygiene';

  @override
  String get qcPACKAGING => 'Packaging';

  @override
  String get qcOTHER => 'Other';

  @override
  String get dispatchBoard => 'Board';

  @override
  String get dispatchRoutes => 'Routes';

  @override
  String get dispatchFailed => 'Failed';

  @override
  String get dispatchHandOffPoints => 'Hand-off points';

  @override
  String get dispatchUnrouted => 'Unrouted';

  @override
  String get dispatchOut => 'Out';

  @override
  String get dispatchChanged => 'Changed after routing';

  @override
  String get dispatchManifest => 'Manifest (slot × zone)';

  @override
  String get dispatchUnroutedOrders => 'Unrouted orders';

  @override
  String get dispatchAllRouted => 'Every order is on a route.';

  @override
  String get dispatchCreateRoute => 'New route';

  @override
  String get dispatchAddToRoute => 'Add to route';

  @override
  String get dispatchAutoGroup => 'Auto-group';

  @override
  String get dispatchAutoGroupConfirm => 'Put every unrouted order on one route per slot × zone?';

  @override
  String dispatchAutoGrouped(int routes, int stops) {
    return '$routes routes, $stops stops';
  }

  @override
  String get dispatchRouteName => 'Route name';

  @override
  String get dispatchSlot => 'Delivery slot';

  @override
  String get dispatchZone => 'Zone';

  @override
  String get dispatchRider => 'Rider';

  @override
  String get dispatchNone => 'None';

  @override
  String get dispatchNoRider => 'No rider yet';

  @override
  String get dispatchAssignRider => 'Assign rider';

  @override
  String get dispatchUnavailable => 'busy';

  @override
  String get dispatchStart => 'Dispatch';

  @override
  String get dispatchComplete => 'Close route';

  @override
  String dispatchStarted(int out, int notPacked) {
    return '$out out for delivery, $notPacked not packed yet';
  }

  @override
  String get dispatchRemoveStop => 'Take off route';

  @override
  String get dispatchNoRoutes => 'No routes yet for this day.';

  @override
  String dispatchCashExpected(Object collected, Object expected) {
    return 'Cash $collected of $expected';
  }

  @override
  String get dispatchNoFailed => 'No failed deliveries for this day.';

  @override
  String get dispatchRetry => 'Retry delivery';

  @override
  String get dispatchCancelCredit => 'Cancel + credit';

  @override
  String get dispatchCancelCreditBody => 'Cancel this order and credit the customer\'s wallet.';

  @override
  String dispatchResolved(Object number) {
    return '$number updated.';
  }

  @override
  String get dispatchPickRoute => 'Choose a route';

  @override
  String dispatchFailedReason(Object reason) {
    return 'Last reason: $reason';
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
