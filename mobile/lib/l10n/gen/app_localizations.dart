import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:intl/intl.dart' as intl;

import 'app_localizations_en.dart';
import 'app_localizations_ne.dart';

// ignore_for_file: type=lint

/// Callers can lookup localized strings with an instance of AppLocalizations
/// returned by `AppLocalizations.of(context)`.
///
/// Applications need to include `AppLocalizations.delegate()` in their app's
/// `localizationDelegates` list, and the locales they support in the app's
/// `supportedLocales` list. For example:
///
/// ```dart
/// import 'gen/app_localizations.dart';
///
/// return MaterialApp(
///   localizationsDelegates: AppLocalizations.localizationsDelegates,
///   supportedLocales: AppLocalizations.supportedLocales,
///   home: MyApplicationHome(),
/// );
/// ```
///
/// ## Update pubspec.yaml
///
/// Please make sure to update your pubspec.yaml to include the following
/// packages:
///
/// ```yaml
/// dependencies:
///   # Internationalization support.
///   flutter_localizations:
///     sdk: flutter
///   intl: any # Use the pinned version from flutter_localizations
///
///   # Rest of dependencies
/// ```
///
/// ## iOS Applications
///
/// iOS applications define key application metadata, including supported
/// locales, in an Info.plist file that is built into the application bundle.
/// To configure the locales supported by your app, you’ll need to edit this
/// file.
///
/// First, open your project’s ios/Runner.xcworkspace Xcode workspace file.
/// Then, in the Project Navigator, open the Info.plist file under the Runner
/// project’s Runner folder.
///
/// Next, select the Information Property List item, select Add Item from the
/// Editor menu, then select Localizations from the pop-up menu.
///
/// Select and expand the newly-created Localizations item then, for each
/// locale your application supports, add a new item and select the locale
/// you wish to add from the pop-up menu in the Value field. This list should
/// be consistent with the languages listed in the AppLocalizations.supportedLocales
/// property.
abstract class AppLocalizations {
  AppLocalizations(String locale) : localeName = intl.Intl.canonicalizedLocale(locale.toString());

  final String localeName;

  static AppLocalizations of(BuildContext context) {
    return Localizations.of<AppLocalizations>(context, AppLocalizations)!;
  }

  static const LocalizationsDelegate<AppLocalizations> delegate = _AppLocalizationsDelegate();

  /// A list of this localizations delegate along with the default localizations
  /// delegates.
  ///
  /// Returns a list of localizations delegates containing this delegate along with
  /// GlobalMaterialLocalizations.delegate, GlobalCupertinoLocalizations.delegate,
  /// and GlobalWidgetsLocalizations.delegate.
  ///
  /// Additional delegates can be added by appending to this list in
  /// MaterialApp. This list does not have to be used at all if a custom list
  /// of delegates is preferred or required.
  static const List<LocalizationsDelegate<dynamic>> localizationsDelegates = <LocalizationsDelegate<dynamic>>[
    delegate,
    GlobalMaterialLocalizations.delegate,
    GlobalCupertinoLocalizations.delegate,
    GlobalWidgetsLocalizations.delegate,
  ];

  /// A list of this localizations delegate's supported locales.
  static const List<Locale> supportedLocales = <Locale>[
    Locale('en'),
    Locale('ne')
  ];

  /// No description provided for @appName.
  ///
  /// In en, this message translates to:
  /// **'Dabba Bela'**
  String get appName;

  /// No description provided for @tagline.
  ///
  /// In en, this message translates to:
  /// **'Your lunch. Your way. Ghar ko swad.'**
  String get tagline;

  /// No description provided for @retry.
  ///
  /// In en, this message translates to:
  /// **'Try again'**
  String get retry;

  /// No description provided for @loading.
  ///
  /// In en, this message translates to:
  /// **'Loading…'**
  String get loading;

  /// No description provided for @save.
  ///
  /// In en, this message translates to:
  /// **'Save'**
  String get save;

  /// No description provided for @cancel.
  ///
  /// In en, this message translates to:
  /// **'Cancel'**
  String get cancel;

  /// No description provided for @close.
  ///
  /// In en, this message translates to:
  /// **'Close'**
  String get close;

  /// No description provided for @confirm.
  ///
  /// In en, this message translates to:
  /// **'Confirm'**
  String get confirm;

  /// No description provided for @continueLabel.
  ///
  /// In en, this message translates to:
  /// **'Continue'**
  String get continueLabel;

  /// No description provided for @back.
  ///
  /// In en, this message translates to:
  /// **'Back'**
  String get back;

  /// No description provided for @edit.
  ///
  /// In en, this message translates to:
  /// **'Edit'**
  String get edit;

  /// No description provided for @delete.
  ///
  /// In en, this message translates to:
  /// **'Delete'**
  String get delete;

  /// No description provided for @add.
  ///
  /// In en, this message translates to:
  /// **'Add'**
  String get add;

  /// No description provided for @done.
  ///
  /// In en, this message translates to:
  /// **'Done'**
  String get done;

  /// No description provided for @yes.
  ///
  /// In en, this message translates to:
  /// **'Yes'**
  String get yes;

  /// No description provided for @no.
  ///
  /// In en, this message translates to:
  /// **'No'**
  String get no;

  /// No description provided for @optional.
  ///
  /// In en, this message translates to:
  /// **'Optional'**
  String get optional;

  /// No description provided for @required.
  ///
  /// In en, this message translates to:
  /// **'Required'**
  String get required;

  /// No description provided for @today.
  ///
  /// In en, this message translates to:
  /// **'Today'**
  String get today;

  /// No description provided for @tomorrow.
  ///
  /// In en, this message translates to:
  /// **'Tomorrow'**
  String get tomorrow;

  /// No description provided for @total.
  ///
  /// In en, this message translates to:
  /// **'Total'**
  String get total;

  /// No description provided for @subtotal.
  ///
  /// In en, this message translates to:
  /// **'Subtotal'**
  String get subtotal;

  /// No description provided for @deliveryFee.
  ///
  /// In en, this message translates to:
  /// **'Delivery'**
  String get deliveryFee;

  /// No description provided for @discount.
  ///
  /// In en, this message translates to:
  /// **'Discount'**
  String get discount;

  /// No description provided for @tax.
  ///
  /// In en, this message translates to:
  /// **'VAT'**
  String get tax;

  /// No description provided for @free.
  ///
  /// In en, this message translates to:
  /// **'Free'**
  String get free;

  /// No description provided for @nothingHere.
  ///
  /// In en, this message translates to:
  /// **'Nothing here yet'**
  String get nothingHere;

  /// No description provided for @pullToRefresh.
  ///
  /// In en, this message translates to:
  /// **'Pull down to refresh'**
  String get pullToRefresh;

  /// No description provided for @errorTitle.
  ///
  /// In en, this message translates to:
  /// **'Couldn\'t load this'**
  String get errorTitle;

  /// No description provided for @offlineTitle.
  ///
  /// In en, this message translates to:
  /// **'You\'re offline'**
  String get offlineTitle;

  /// No description provided for @offlineBody.
  ///
  /// In en, this message translates to:
  /// **'Check your connection and try again. Nothing was lost.'**
  String get offlineBody;

  /// No description provided for @noPermission.
  ///
  /// In en, this message translates to:
  /// **'Your account doesn\'t have access to this.'**
  String get noPermission;

  /// No description provided for @loadMore.
  ///
  /// In en, this message translates to:
  /// **'Load more'**
  String get loadMore;

  /// No description provided for @saved.
  ///
  /// In en, this message translates to:
  /// **'Saved'**
  String get saved;

  /// No description provided for @date.
  ///
  /// In en, this message translates to:
  /// **'Date'**
  String get date;

  /// No description provided for @pickDate.
  ///
  /// In en, this message translates to:
  /// **'Pick a date'**
  String get pickDate;

  /// No description provided for @reason.
  ///
  /// In en, this message translates to:
  /// **'Reason'**
  String get reason;

  /// No description provided for @note.
  ///
  /// In en, this message translates to:
  /// **'Note'**
  String get note;

  /// No description provided for @status.
  ///
  /// In en, this message translates to:
  /// **'Status'**
  String get status;

  /// No description provided for @switchApp.
  ///
  /// In en, this message translates to:
  /// **'Switch app'**
  String get switchApp;

  /// No description provided for @chooseApp.
  ///
  /// In en, this message translates to:
  /// **'Where do you want to go?'**
  String get chooseApp;

  /// No description provided for @appCustomer.
  ///
  /// In en, this message translates to:
  /// **'Order lunch'**
  String get appCustomer;

  /// No description provided for @appCustomerHint.
  ///
  /// In en, this message translates to:
  /// **'Menu, meal plans, your orders'**
  String get appCustomerHint;

  /// No description provided for @appRider.
  ///
  /// In en, this message translates to:
  /// **'Rider'**
  String get appRider;

  /// No description provided for @appRiderHint.
  ///
  /// In en, this message translates to:
  /// **'Today\'s routes and deliveries'**
  String get appRiderHint;

  /// No description provided for @appKitchen.
  ///
  /// In en, this message translates to:
  /// **'Kitchen'**
  String get appKitchen;

  /// No description provided for @appKitchenHint.
  ///
  /// In en, this message translates to:
  /// **'Production, packing, QC'**
  String get appKitchenHint;

  /// No description provided for @appDispatcher.
  ///
  /// In en, this message translates to:
  /// **'Dispatch'**
  String get appDispatcher;

  /// No description provided for @appDispatcherHint.
  ///
  /// In en, this message translates to:
  /// **'Board, routes, riders, failed deliveries'**
  String get appDispatcherHint;

  /// No description provided for @signOut.
  ///
  /// In en, this message translates to:
  /// **'Sign out'**
  String get signOut;

  /// No description provided for @signOutConfirm.
  ///
  /// In en, this message translates to:
  /// **'Sign out of Dabba Bela on this phone?'**
  String get signOutConfirm;

  /// No description provided for @language.
  ///
  /// In en, this message translates to:
  /// **'Language'**
  String get language;

  /// No description provided for @languageEnglish.
  ///
  /// In en, this message translates to:
  /// **'English'**
  String get languageEnglish;

  /// No description provided for @languageNepali.
  ///
  /// In en, this message translates to:
  /// **'नेपाली'**
  String get languageNepali;

  /// No description provided for @kitchen.
  ///
  /// In en, this message translates to:
  /// **'Kitchen'**
  String get kitchen;

  /// No description provided for @pickKitchen.
  ///
  /// In en, this message translates to:
  /// **'Choose a kitchen'**
  String get pickKitchen;

  /// No description provided for @noKitchens.
  ///
  /// In en, this message translates to:
  /// **'No kitchens are in your scope. Ask an admin to add you to one.'**
  String get noKitchens;

  /// No description provided for @twoFactorSetupBanner.
  ///
  /// In en, this message translates to:
  /// **'Set up your authenticator app to open the staff sections.'**
  String get twoFactorSetupBanner;

  /// No description provided for @setUpNow.
  ///
  /// In en, this message translates to:
  /// **'Set up now'**
  String get setUpNow;

  /// No description provided for @call.
  ///
  /// In en, this message translates to:
  /// **'Call'**
  String get call;

  /// No description provided for @navigate.
  ///
  /// In en, this message translates to:
  /// **'Navigate'**
  String get navigate;

  /// No description provided for @share.
  ///
  /// In en, this message translates to:
  /// **'Share'**
  String get share;

  /// No description provided for @copy.
  ///
  /// In en, this message translates to:
  /// **'Copy'**
  String get copy;

  /// No description provided for @copied.
  ///
  /// In en, this message translates to:
  /// **'Copied'**
  String get copied;

  /// No description provided for @selectAll.
  ///
  /// In en, this message translates to:
  /// **'Select all'**
  String get selectAll;

  /// No description provided for @selectedCount.
  ///
  /// In en, this message translates to:
  /// **'{count} selected'**
  String selectedCount(int count);

  /// No description provided for @meals.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =1{1 meal} other{{count} meals}}'**
  String meals(int count);

  /// No description provided for @orderCount.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =1{1 order} other{{count} orders}}'**
  String orderCount(int count);

  /// No description provided for @stPENDING_PAYMENT.
  ///
  /// In en, this message translates to:
  /// **'Payment pending'**
  String get stPENDING_PAYMENT;

  /// No description provided for @stSCHEDULED.
  ///
  /// In en, this message translates to:
  /// **'Scheduled'**
  String get stSCHEDULED;

  /// No description provided for @stCONFIRMED.
  ///
  /// In en, this message translates to:
  /// **'Confirmed'**
  String get stCONFIRMED;

  /// No description provided for @stPREPARING.
  ///
  /// In en, this message translates to:
  /// **'In the kitchen'**
  String get stPREPARING;

  /// No description provided for @stPACKED.
  ///
  /// In en, this message translates to:
  /// **'Packed'**
  String get stPACKED;

  /// No description provided for @stOUT_FOR_DELIVERY.
  ///
  /// In en, this message translates to:
  /// **'On the way'**
  String get stOUT_FOR_DELIVERY;

  /// No description provided for @stDELIVERED.
  ///
  /// In en, this message translates to:
  /// **'Delivered'**
  String get stDELIVERED;

  /// No description provided for @stFAILED_DELIVERY.
  ///
  /// In en, this message translates to:
  /// **'Delivery failed'**
  String get stFAILED_DELIVERY;

  /// No description provided for @stCANCELLED.
  ///
  /// In en, this message translates to:
  /// **'Cancelled'**
  String get stCANCELLED;

  /// No description provided for @stSKIPPED.
  ///
  /// In en, this message translates to:
  /// **'Skipped'**
  String get stSKIPPED;

  /// No description provided for @stPENDING.
  ///
  /// In en, this message translates to:
  /// **'Pending'**
  String get stPENDING;

  /// No description provided for @stPAID.
  ///
  /// In en, this message translates to:
  /// **'Paid'**
  String get stPAID;

  /// No description provided for @stFAILED.
  ///
  /// In en, this message translates to:
  /// **'Failed'**
  String get stFAILED;

  /// No description provided for @stREFUNDED.
  ///
  /// In en, this message translates to:
  /// **'Refunded'**
  String get stREFUNDED;

  /// No description provided for @stPARTIALLY_REFUNDED.
  ///
  /// In en, this message translates to:
  /// **'Partly refunded'**
  String get stPARTIALLY_REFUNDED;

  /// No description provided for @stACTIVE.
  ///
  /// In en, this message translates to:
  /// **'Active'**
  String get stACTIVE;

  /// No description provided for @stPAUSED.
  ///
  /// In en, this message translates to:
  /// **'Paused'**
  String get stPAUSED;

  /// No description provided for @stCOMPLETED.
  ///
  /// In en, this message translates to:
  /// **'Completed'**
  String get stCOMPLETED;

  /// No description provided for @stPLANNED.
  ///
  /// In en, this message translates to:
  /// **'Planned'**
  String get stPLANNED;

  /// No description provided for @stOUT.
  ///
  /// In en, this message translates to:
  /// **'Out'**
  String get stOUT;

  /// No description provided for @stDONE.
  ///
  /// In en, this message translates to:
  /// **'Done'**
  String get stDONE;

  /// No description provided for @stCOOKING.
  ///
  /// In en, this message translates to:
  /// **'Cooking'**
  String get stCOOKING;

  /// No description provided for @stOPEN.
  ///
  /// In en, this message translates to:
  /// **'Open'**
  String get stOPEN;

  /// No description provided for @stRESOLVED.
  ///
  /// In en, this message translates to:
  /// **'Resolved'**
  String get stRESOLVED;

  /// No description provided for @stCLOSED.
  ///
  /// In en, this message translates to:
  /// **'Closed'**
  String get stCLOSED;

  /// No description provided for @stREJECTED.
  ///
  /// In en, this message translates to:
  /// **'Rejected'**
  String get stREJECTED;

  /// No description provided for @pmESEWA.
  ///
  /// In en, this message translates to:
  /// **'eSewa'**
  String get pmESEWA;

  /// No description provided for @pmKHALTI.
  ///
  /// In en, this message translates to:
  /// **'Khalti'**
  String get pmKHALTI;

  /// No description provided for @pmBANK_TRANSFER.
  ///
  /// In en, this message translates to:
  /// **'Bank transfer / QR'**
  String get pmBANK_TRANSFER;

  /// No description provided for @pmCASH.
  ///
  /// In en, this message translates to:
  /// **'Cash on delivery'**
  String get pmCASH;

  /// No description provided for @pmCOMPANY_INVOICE.
  ///
  /// In en, this message translates to:
  /// **'Company invoice'**
  String get pmCOMPANY_INVOICE;

  /// No description provided for @pmWALLET.
  ///
  /// In en, this message translates to:
  /// **'Dabba credit'**
  String get pmWALLET;

  /// No description provided for @daySUN.
  ///
  /// In en, this message translates to:
  /// **'Sun'**
  String get daySUN;

  /// No description provided for @dayMON.
  ///
  /// In en, this message translates to:
  /// **'Mon'**
  String get dayMON;

  /// No description provided for @dayTUE.
  ///
  /// In en, this message translates to:
  /// **'Tue'**
  String get dayTUE;

  /// No description provided for @dayWED.
  ///
  /// In en, this message translates to:
  /// **'Wed'**
  String get dayWED;

  /// No description provided for @dayTHU.
  ///
  /// In en, this message translates to:
  /// **'Thu'**
  String get dayTHU;

  /// No description provided for @dayFRI.
  ///
  /// In en, this message translates to:
  /// **'Fri'**
  String get dayFRI;

  /// No description provided for @daySAT.
  ///
  /// In en, this message translates to:
  /// **'Sat'**
  String get daySAT;

  /// No description provided for @dietVEG.
  ///
  /// In en, this message translates to:
  /// **'Veg'**
  String get dietVEG;

  /// No description provided for @dietVEGAN.
  ///
  /// In en, this message translates to:
  /// **'Vegan'**
  String get dietVEGAN;

  /// No description provided for @dietEGG.
  ///
  /// In en, this message translates to:
  /// **'Egg'**
  String get dietEGG;

  /// No description provided for @dietNONVEG.
  ///
  /// In en, this message translates to:
  /// **'Non-veg'**
  String get dietNONVEG;
}

class _AppLocalizationsDelegate extends LocalizationsDelegate<AppLocalizations> {
  const _AppLocalizationsDelegate();

  @override
  Future<AppLocalizations> load(Locale locale) {
    return SynchronousFuture<AppLocalizations>(lookupAppLocalizations(locale));
  }

  @override
  bool isSupported(Locale locale) => <String>['en', 'ne'].contains(locale.languageCode);

  @override
  bool shouldReload(_AppLocalizationsDelegate old) => false;
}

AppLocalizations lookupAppLocalizations(Locale locale) {


  // Lookup logic when only language code is specified.
  switch (locale.languageCode) {
    case 'en': return AppLocalizationsEn();
    case 'ne': return AppLocalizationsNe();
  }

  throw FlutterError(
    'AppLocalizations.delegate failed to load unsupported locale "$locale". This is likely '
    'an issue with the localizations generation tool. Please file an issue '
    'on GitHub with a reproducible sample app and the gen-l10n configuration '
    'that was used.'
  );
}
