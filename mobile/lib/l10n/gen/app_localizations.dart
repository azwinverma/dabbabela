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

  /// No description provided for @signIn.
  ///
  /// In en, this message translates to:
  /// **'Sign in'**
  String get signIn;

  /// No description provided for @signInTitle.
  ///
  /// In en, this message translates to:
  /// **'Welcome back'**
  String get signInTitle;

  /// No description provided for @signUp.
  ///
  /// In en, this message translates to:
  /// **'Create account'**
  String get signUp;

  /// No description provided for @signUpTitle.
  ///
  /// In en, this message translates to:
  /// **'Lunch, on time, wherever you are'**
  String get signUpTitle;

  /// No description provided for @haveAccount.
  ///
  /// In en, this message translates to:
  /// **'Already have an account? Sign in'**
  String get haveAccount;

  /// No description provided for @noAccount.
  ///
  /// In en, this message translates to:
  /// **'New here? Create an account'**
  String get noAccount;

  /// No description provided for @email.
  ///
  /// In en, this message translates to:
  /// **'Email'**
  String get email;

  /// No description provided for @password.
  ///
  /// In en, this message translates to:
  /// **'Password'**
  String get password;

  /// No description provided for @newPassword.
  ///
  /// In en, this message translates to:
  /// **'New password'**
  String get newPassword;

  /// No description provided for @name.
  ///
  /// In en, this message translates to:
  /// **'Full name'**
  String get name;

  /// No description provided for @phone.
  ///
  /// In en, this message translates to:
  /// **'Mobile number'**
  String get phone;

  /// No description provided for @phoneHint.
  ///
  /// In en, this message translates to:
  /// **'98XXXXXXXX'**
  String get phoneHint;

  /// No description provided for @companyCode.
  ///
  /// In en, this message translates to:
  /// **'Company code'**
  String get companyCode;

  /// No description provided for @referralCode.
  ///
  /// In en, this message translates to:
  /// **'Referral code'**
  String get referralCode;

  /// No description provided for @showPassword.
  ///
  /// In en, this message translates to:
  /// **'Show password'**
  String get showPassword;

  /// No description provided for @invalidEmail.
  ///
  /// In en, this message translates to:
  /// **'Enter a valid email'**
  String get invalidEmail;

  /// No description provided for @invalidPhone.
  ///
  /// In en, this message translates to:
  /// **'Enter a Nepal mobile number (98/97/96 + 8 digits)'**
  String get invalidPhone;

  /// No description provided for @passwordTooShort.
  ///
  /// In en, this message translates to:
  /// **'At least 8 characters'**
  String get passwordTooShort;

  /// No description provided for @forgotPassword.
  ///
  /// In en, this message translates to:
  /// **'Forgot password?'**
  String get forgotPassword;

  /// No description provided for @forgotTitle.
  ///
  /// In en, this message translates to:
  /// **'Reset your password'**
  String get forgotTitle;

  /// No description provided for @forgotBody.
  ///
  /// In en, this message translates to:
  /// **'We\'ll email you a link. Open it on this phone, or copy the code from the link into “I have a reset code”.'**
  String get forgotBody;

  /// No description provided for @sendLink.
  ///
  /// In en, this message translates to:
  /// **'Send reset link'**
  String get sendLink;

  /// No description provided for @haveResetCode.
  ///
  /// In en, this message translates to:
  /// **'I have a reset code'**
  String get haveResetCode;

  /// No description provided for @resetCode.
  ///
  /// In en, this message translates to:
  /// **'Reset code (from the email link)'**
  String get resetCode;

  /// No description provided for @setPassword.
  ///
  /// In en, this message translates to:
  /// **'Set new password'**
  String get setPassword;

  /// No description provided for @passwordReset.
  ///
  /// In en, this message translates to:
  /// **'Password changed. Sign in with the new one.'**
  String get passwordReset;

  /// No description provided for @twoFactorTitle.
  ///
  /// In en, this message translates to:
  /// **'Enter your authenticator code'**
  String get twoFactorTitle;

  /// No description provided for @twoFactorBody.
  ///
  /// In en, this message translates to:
  /// **'Open your authenticator app and type the 6-digit code for Dabba Bela.'**
  String get twoFactorBody;

  /// No description provided for @code.
  ///
  /// In en, this message translates to:
  /// **'Code'**
  String get code;

  /// No description provided for @verify.
  ///
  /// In en, this message translates to:
  /// **'Verify'**
  String get verify;

  /// No description provided for @useBackupCode.
  ///
  /// In en, this message translates to:
  /// **'Use a backup code instead'**
  String get useBackupCode;

  /// No description provided for @useAuthenticator.
  ///
  /// In en, this message translates to:
  /// **'Use the authenticator app'**
  String get useAuthenticator;

  /// No description provided for @backupCode.
  ///
  /// In en, this message translates to:
  /// **'Backup code'**
  String get backupCode;

  /// No description provided for @challengeExpired.
  ///
  /// In en, this message translates to:
  /// **'That sign-in expired. Please sign in again.'**
  String get challengeExpired;

  /// No description provided for @phoneSignIn.
  ///
  /// In en, this message translates to:
  /// **'Sign in with an SMS code'**
  String get phoneSignIn;

  /// No description provided for @sendCode.
  ///
  /// In en, this message translates to:
  /// **'Send code'**
  String get sendCode;

  /// No description provided for @codeSent.
  ///
  /// In en, this message translates to:
  /// **'We sent a code to {phone}'**
  String codeSent(Object phone);

  /// No description provided for @resendCode.
  ///
  /// In en, this message translates to:
  /// **'Send a new code'**
  String get resendCode;

  /// No description provided for @enrolTitle.
  ///
  /// In en, this message translates to:
  /// **'Set up two-step sign-in'**
  String get enrolTitle;

  /// No description provided for @enrolIntro.
  ///
  /// In en, this message translates to:
  /// **'Staff accounts need an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password…). Confirm your password to start.'**
  String get enrolIntro;

  /// No description provided for @enrolScan.
  ///
  /// In en, this message translates to:
  /// **'Scan this QR code with your authenticator app, or enter the key by hand.'**
  String get enrolScan;

  /// No description provided for @enrolSecret.
  ///
  /// In en, this message translates to:
  /// **'Setup key'**
  String get enrolSecret;

  /// No description provided for @backupCodesTitle.
  ///
  /// In en, this message translates to:
  /// **'Backup codes'**
  String get backupCodesTitle;

  /// No description provided for @backupCodesBody.
  ///
  /// In en, this message translates to:
  /// **'Save these somewhere safe. Each works once if you lose your phone. They won\'t be shown again.'**
  String get backupCodesBody;

  /// No description provided for @enrolConfirm.
  ///
  /// In en, this message translates to:
  /// **'Enter the 6-digit code from the app to finish'**
  String get enrolConfirm;

  /// No description provided for @enrolDone.
  ///
  /// In en, this message translates to:
  /// **'Two-step sign-in is on.'**
  String get enrolDone;

  /// No description provided for @twoFactorOn.
  ///
  /// In en, this message translates to:
  /// **'Two-step sign-in is on for this account.'**
  String get twoFactorOn;

  /// No description provided for @sessionsTitle.
  ///
  /// In en, this message translates to:
  /// **'Signed-in devices'**
  String get sessionsTitle;

  /// No description provided for @thisDevice.
  ///
  /// In en, this message translates to:
  /// **'This device'**
  String get thisDevice;

  /// No description provided for @signOutOthers.
  ///
  /// In en, this message translates to:
  /// **'Sign out all other devices'**
  String get signOutOthers;

  /// No description provided for @revoke.
  ///
  /// In en, this message translates to:
  /// **'Sign out'**
  String get revoke;

  /// No description provided for @lastActive.
  ///
  /// In en, this message translates to:
  /// **'Last active {when}'**
  String lastActive(Object when);

  /// No description provided for @maintenance.
  ///
  /// In en, this message translates to:
  /// **'We\'re doing some maintenance'**
  String get maintenance;

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

  /// No description provided for @tabHome.
  ///
  /// In en, this message translates to:
  /// **'Home'**
  String get tabHome;

  /// No description provided for @tabMenu.
  ///
  /// In en, this message translates to:
  /// **'Menu'**
  String get tabMenu;

  /// No description provided for @tabPlans.
  ///
  /// In en, this message translates to:
  /// **'Plans'**
  String get tabPlans;

  /// No description provided for @tabOrders.
  ///
  /// In en, this message translates to:
  /// **'Orders'**
  String get tabOrders;

  /// No description provided for @tabAccount.
  ///
  /// In en, this message translates to:
  /// **'Account'**
  String get tabAccount;

  /// No description provided for @hello.
  ///
  /// In en, this message translates to:
  /// **'Namaste, {name}'**
  String hello(Object name);

  /// No description provided for @todaysLunch.
  ///
  /// In en, this message translates to:
  /// **'Today\'s lunch'**
  String get todaysLunch;

  /// No description provided for @upcomingMeals.
  ///
  /// In en, this message translates to:
  /// **'Coming up'**
  String get upcomingMeals;

  /// No description provided for @noUpcoming.
  ///
  /// In en, this message translates to:
  /// **'No meals booked. Pick something from this week\'s menu.'**
  String get noUpcoming;

  /// No description provided for @browseMenu.
  ///
  /// In en, this message translates to:
  /// **'See the menu'**
  String get browseMenu;

  /// No description provided for @planProgress.
  ///
  /// In en, this message translates to:
  /// **'{done} of {total} meals delivered'**
  String planProgress(int done, int total);

  /// No description provided for @handOffCode.
  ///
  /// In en, this message translates to:
  /// **'Hand-off code'**
  String get handOffCode;

  /// No description provided for @handOffHelp.
  ///
  /// In en, this message translates to:
  /// **'Tell this code to the rider when your dabba arrives.'**
  String get handOffHelp;

  /// No description provided for @companyMenu.
  ///
  /// In en, this message translates to:
  /// **'Showing your company\'s lunch menu ({company})'**
  String companyMenu(Object company);

  /// No description provided for @noMenu.
  ///
  /// In en, this message translates to:
  /// **'This week\'s menu isn\'t published yet'**
  String get noMenu;

  /// No description provided for @prevWeek.
  ///
  /// In en, this message translates to:
  /// **'Previous week'**
  String get prevWeek;

  /// No description provided for @nextWeek.
  ///
  /// In en, this message translates to:
  /// **'Next week'**
  String get nextWeek;

  /// No description provided for @orderBy.
  ///
  /// In en, this message translates to:
  /// **'Order by {time}'**
  String orderBy(Object time);

  /// No description provided for @orderClosed.
  ///
  /// In en, this message translates to:
  /// **'Ordering closed'**
  String get orderClosed;

  /// No description provided for @kitchenClosed.
  ///
  /// In en, this message translates to:
  /// **'Kitchen closed'**
  String get kitchenClosed;

  /// No description provided for @soldOut.
  ///
  /// In en, this message translates to:
  /// **'Sold out'**
  String get soldOut;

  /// No description provided for @onlyLeft.
  ///
  /// In en, this message translates to:
  /// **'Only {n} left'**
  String onlyLeft(int n);

  /// No description provided for @chefsPick.
  ///
  /// In en, this message translates to:
  /// **'Chef\'s pick'**
  String get chefsPick;

  /// No description provided for @addToCart.
  ///
  /// In en, this message translates to:
  /// **'Add to my dabbas'**
  String get addToCart;

  /// No description provided for @addedToCart.
  ///
  /// In en, this message translates to:
  /// **'Added — {name}'**
  String addedToCart(Object name);

  /// No description provided for @whatsInside.
  ///
  /// In en, this message translates to:
  /// **'What\'s inside'**
  String get whatsInside;

  /// No description provided for @allergens.
  ///
  /// In en, this message translates to:
  /// **'Allergens'**
  String get allergens;

  /// No description provided for @mayContain.
  ///
  /// In en, this message translates to:
  /// **'may contain'**
  String get mayContain;

  /// No description provided for @noAllergens.
  ///
  /// In en, this message translates to:
  /// **'No listed allergens'**
  String get noAllergens;

  /// No description provided for @sharedKitchen.
  ///
  /// In en, this message translates to:
  /// **'Cooked in a shared kitchen that uses wheat, milk, egg, soy, sesame and mustard. We can\'t guarantee zero cross-contact.'**
  String get sharedKitchen;

  /// No description provided for @allergyWarning.
  ///
  /// In en, this message translates to:
  /// **'Contains something on your allergy list: {list}'**
  String allergyWarning(Object list);

  /// No description provided for @nutrition.
  ///
  /// In en, this message translates to:
  /// **'Nutrition (estimated)'**
  String get nutrition;

  /// No description provided for @nutritionNote.
  ///
  /// In en, this message translates to:
  /// **'Estimated from our recipes, not lab-tested.'**
  String get nutritionNote;

  /// No description provided for @spiceLevel.
  ///
  /// In en, this message translates to:
  /// **'Spice {n}/4'**
  String spiceLevel(int n);

  /// No description provided for @pickDay.
  ///
  /// In en, this message translates to:
  /// **'Delivery day'**
  String get pickDay;

  /// No description provided for @noDays.
  ///
  /// In en, this message translates to:
  /// **'No delivery days are open for this dabba right now.'**
  String get noDays;

  /// No description provided for @offCompanyMenu.
  ///
  /// In en, this message translates to:
  /// **'Not on your company\'s menu.'**
  String get offCompanyMenu;

  /// No description provided for @swaps.
  ///
  /// In en, this message translates to:
  /// **'Chef-approved swaps'**
  String get swaps;

  /// No description provided for @quantity.
  ///
  /// In en, this message translates to:
  /// **'Quantity'**
  String get quantity;

  /// No description provided for @cart.
  ///
  /// In en, this message translates to:
  /// **'My dabbas'**
  String get cart;

  /// No description provided for @cartEmpty.
  ///
  /// In en, this message translates to:
  /// **'Your cart is empty.'**
  String get cartEmpty;

  /// No description provided for @checkout.
  ///
  /// In en, this message translates to:
  /// **'Checkout'**
  String get checkout;

  /// No description provided for @deliverTo.
  ///
  /// In en, this message translates to:
  /// **'Deliver to'**
  String get deliverTo;

  /// No description provided for @addAddress.
  ///
  /// In en, this message translates to:
  /// **'Add a delivery address'**
  String get addAddress;

  /// No description provided for @changeAddress.
  ///
  /// In en, this message translates to:
  /// **'Change address'**
  String get changeAddress;

  /// No description provided for @deliverySlot.
  ///
  /// In en, this message translates to:
  /// **'Delivery time'**
  String get deliverySlot;

  /// No description provided for @anySlot.
  ///
  /// In en, this message translates to:
  /// **'Usual lunch window'**
  String get anySlot;

  /// No description provided for @payWith.
  ///
  /// In en, this message translates to:
  /// **'Pay with'**
  String get payWith;

  /// No description provided for @walletBalanceShort.
  ///
  /// In en, this message translates to:
  /// **'Balance {amount}'**
  String walletBalanceShort(Object amount);

  /// No description provided for @coupon.
  ///
  /// In en, this message translates to:
  /// **'Coupon code'**
  String get coupon;

  /// No description provided for @apply.
  ///
  /// In en, this message translates to:
  /// **'Apply'**
  String get apply;

  /// No description provided for @notesForKitchen.
  ///
  /// In en, this message translates to:
  /// **'Notes for the rider'**
  String get notesForKitchen;

  /// No description provided for @companyPays.
  ///
  /// In en, this message translates to:
  /// **'{company} pays'**
  String companyPays(Object company);

  /// No description provided for @couponDiscount.
  ///
  /// In en, this message translates to:
  /// **'Coupon'**
  String get couponDiscount;

  /// No description provided for @youPay.
  ///
  /// In en, this message translates to:
  /// **'You pay'**
  String get youPay;

  /// No description provided for @taxIncluded.
  ///
  /// In en, this message translates to:
  /// **'Prices include VAT'**
  String get taxIncluded;

  /// No description provided for @placeOrder.
  ///
  /// In en, this message translates to:
  /// **'Place order'**
  String get placeOrder;

  /// No description provided for @fixProblems.
  ///
  /// In en, this message translates to:
  /// **'Fix the highlighted items to continue.'**
  String get fixProblems;

  /// No description provided for @orderPlaced.
  ///
  /// In en, this message translates to:
  /// **'Order placed!'**
  String get orderPlaced;

  /// No description provided for @orderPlacedBody.
  ///
  /// In en, this message translates to:
  /// **'We\'ll start cooking on the day. You\'ll see each dabba under Orders.'**
  String get orderPlacedBody;

  /// No description provided for @viewOrders.
  ///
  /// In en, this message translates to:
  /// **'View my orders'**
  String get viewOrders;

  /// No description provided for @payment.
  ///
  /// In en, this message translates to:
  /// **'Payment'**
  String get payment;

  /// No description provided for @payNow.
  ///
  /// In en, this message translates to:
  /// **'Pay {amount} now'**
  String payNow(Object amount);

  /// No description provided for @openingGateway.
  ///
  /// In en, this message translates to:
  /// **'Opening {gateway}…'**
  String openingGateway(Object gateway);

  /// No description provided for @checkingPayment.
  ///
  /// In en, this message translates to:
  /// **'Checking your payment with the gateway…'**
  String get checkingPayment;

  /// No description provided for @paymentPaid.
  ///
  /// In en, this message translates to:
  /// **'Payment received. Thank you!'**
  String get paymentPaid;

  /// No description provided for @paymentFailed.
  ///
  /// In en, this message translates to:
  /// **'The payment didn\'t go through. You can try again or pick another method.'**
  String get paymentFailed;

  /// No description provided for @paymentStillPending.
  ///
  /// In en, this message translates to:
  /// **'We haven\'t heard from the gateway yet. If money left your account it will show here shortly — don\'t pay twice.'**
  String get paymentStillPending;

  /// No description provided for @paymentExpired.
  ///
  /// In en, this message translates to:
  /// **'This payment is no longer open.'**
  String get paymentExpired;

  /// No description provided for @checkAgain.
  ///
  /// In en, this message translates to:
  /// **'Check again'**
  String get checkAgain;

  /// No description provided for @switchMethod.
  ///
  /// In en, this message translates to:
  /// **'Pay another way'**
  String get switchMethod;

  /// No description provided for @bankDetails.
  ///
  /// In en, this message translates to:
  /// **'Bank details'**
  String get bankDetails;

  /// No description provided for @bankHelp.
  ///
  /// In en, this message translates to:
  /// **'Transfer the exact amount, then upload a screenshot or photo of the receipt.'**
  String get bankHelp;

  /// No description provided for @transferReference.
  ///
  /// In en, this message translates to:
  /// **'Transfer reference / transaction ID'**
  String get transferReference;

  /// No description provided for @chooseReceipt.
  ///
  /// In en, this message translates to:
  /// **'Choose receipt photo'**
  String get chooseReceipt;

  /// No description provided for @takeReceiptPhoto.
  ///
  /// In en, this message translates to:
  /// **'Take a photo'**
  String get takeReceiptPhoto;

  /// No description provided for @uploadProof.
  ///
  /// In en, this message translates to:
  /// **'Send proof'**
  String get uploadProof;

  /// No description provided for @proofSent.
  ///
  /// In en, this message translates to:
  /// **'Proof received — we\'ll confirm it shortly.'**
  String get proofSent;

  /// No description provided for @awaitingVerification.
  ///
  /// In en, this message translates to:
  /// **'Waiting for our team to verify your transfer.'**
  String get awaitingVerification;

  /// No description provided for @cashNote.
  ///
  /// In en, this message translates to:
  /// **'Pay the rider in cash when your dabba arrives.'**
  String get cashNote;

  /// No description provided for @gatewayTitle.
  ///
  /// In en, this message translates to:
  /// **'Secure payment'**
  String get gatewayTitle;

  /// No description provided for @ordersUpcoming.
  ///
  /// In en, this message translates to:
  /// **'Upcoming'**
  String get ordersUpcoming;

  /// No description provided for @ordersPast.
  ///
  /// In en, this message translates to:
  /// **'Past'**
  String get ordersPast;

  /// No description provided for @noOrders.
  ///
  /// In en, this message translates to:
  /// **'No orders here yet.'**
  String get noOrders;

  /// No description provided for @orderNumber.
  ///
  /// In en, this message translates to:
  /// **'Order {number}'**
  String orderNumber(Object number);

  /// No description provided for @items.
  ///
  /// In en, this message translates to:
  /// **'Items'**
  String get items;

  /// No description provided for @delivery.
  ///
  /// In en, this message translates to:
  /// **'Delivery'**
  String get delivery;

  /// No description provided for @timeline.
  ///
  /// In en, this message translates to:
  /// **'Tracking'**
  String get timeline;

  /// No description provided for @changesUntil.
  ///
  /// In en, this message translates to:
  /// **'Changes allowed until {time}'**
  String changesUntil(Object time);

  /// No description provided for @cancelOrder.
  ///
  /// In en, this message translates to:
  /// **'Cancel order'**
  String get cancelOrder;

  /// No description provided for @cancelOrderBody.
  ///
  /// In en, this message translates to:
  /// **'Paid money goes back as Dabba credit or a refund, per our policy.'**
  String get cancelOrderBody;

  /// No description provided for @skipMeal.
  ///
  /// In en, this message translates to:
  /// **'Skip this day'**
  String get skipMeal;

  /// No description provided for @unskipMeal.
  ///
  /// In en, this message translates to:
  /// **'Bring it back'**
  String get unskipMeal;

  /// No description provided for @swapDabba.
  ///
  /// In en, this message translates to:
  /// **'Swap dabba'**
  String get swapDabba;

  /// No description provided for @swapTitle.
  ///
  /// In en, this message translates to:
  /// **'Swap to another dabba'**
  String get swapTitle;

  /// No description provided for @swapPayMore.
  ///
  /// In en, this message translates to:
  /// **'+{amount} to pay'**
  String swapPayMore(Object amount);

  /// No description provided for @swapCredit.
  ///
  /// In en, this message translates to:
  /// **'{amount} back as credit'**
  String swapCredit(Object amount);

  /// No description provided for @swapSame.
  ///
  /// In en, this message translates to:
  /// **'Same price'**
  String get swapSame;

  /// No description provided for @current.
  ///
  /// In en, this message translates to:
  /// **'Current'**
  String get current;

  /// No description provided for @payDifferenceWith.
  ///
  /// In en, this message translates to:
  /// **'Pay the difference with'**
  String get payDifferenceWith;

  /// No description provided for @rateMeal.
  ///
  /// In en, this message translates to:
  /// **'Rate this dabba'**
  String get rateMeal;

  /// No description provided for @comment.
  ///
  /// In en, this message translates to:
  /// **'Comment'**
  String get comment;

  /// No description provided for @thanksFeedback.
  ///
  /// In en, this message translates to:
  /// **'Thanks for the feedback!'**
  String get thanksFeedback;

  /// No description provided for @getHelp.
  ///
  /// In en, this message translates to:
  /// **'Get help with this order'**
  String get getHelp;

  /// No description provided for @plansTitle.
  ///
  /// In en, this message translates to:
  /// **'Meal plans'**
  String get plansTitle;

  /// No description provided for @myPlans.
  ///
  /// In en, this message translates to:
  /// **'My plans'**
  String get myPlans;

  /// No description provided for @perMeal.
  ///
  /// In en, this message translates to:
  /// **'per meal'**
  String get perMeal;

  /// No description provided for @popular.
  ///
  /// In en, this message translates to:
  /// **'Popular'**
  String get popular;

  /// No description provided for @deliveryIncluded.
  ///
  /// In en, this message translates to:
  /// **'Delivery included'**
  String get deliveryIncluded;

  /// No description provided for @choosePlan.
  ///
  /// In en, this message translates to:
  /// **'Choose this plan'**
  String get choosePlan;

  /// No description provided for @startDate.
  ///
  /// In en, this message translates to:
  /// **'Start date'**
  String get startDate;

  /// No description provided for @deliveryDays.
  ///
  /// In en, this message translates to:
  /// **'Delivery days'**
  String get deliveryDays;

  /// No description provided for @minDays.
  ///
  /// In en, this message translates to:
  /// **'At least {n} days a week'**
  String minDays(int n);

  /// No description provided for @weeks.
  ///
  /// In en, this message translates to:
  /// **'Weeks'**
  String get weeks;

  /// No description provided for @vegOnly.
  ///
  /// In en, this message translates to:
  /// **'Vegetarian only'**
  String get vegOnly;

  /// No description provided for @chefRotation.
  ///
  /// In en, this message translates to:
  /// **'Dabbas follow the chef\'s rotation; you can swap any day before the cut-off.'**
  String get chefRotation;

  /// No description provided for @subscribe.
  ///
  /// In en, this message translates to:
  /// **'Start plan'**
  String get subscribe;

  /// No description provided for @planStarted.
  ///
  /// In en, this message translates to:
  /// **'Your plan is set!'**
  String get planStarted;

  /// No description provided for @planEnds.
  ///
  /// In en, this message translates to:
  /// **'Ends {date}'**
  String planEnds(Object date);

  /// No description provided for @savings.
  ///
  /// In en, this message translates to:
  /// **'You save'**
  String get savings;

  /// No description provided for @noPlans.
  ///
  /// In en, this message translates to:
  /// **'You don\'t have a meal plan yet.'**
  String get noPlans;

  /// No description provided for @planMeals.
  ///
  /// In en, this message translates to:
  /// **'Meals'**
  String get planMeals;

  /// No description provided for @pausePlan.
  ///
  /// In en, this message translates to:
  /// **'Pause'**
  String get pausePlan;

  /// No description provided for @pauseFrom.
  ///
  /// In en, this message translates to:
  /// **'Pause from'**
  String get pauseFrom;

  /// No description provided for @resumePlan.
  ///
  /// In en, this message translates to:
  /// **'Resume'**
  String get resumePlan;

  /// No description provided for @cancelPlan.
  ///
  /// In en, this message translates to:
  /// **'Cancel plan'**
  String get cancelPlan;

  /// No description provided for @renewPlan.
  ///
  /// In en, this message translates to:
  /// **'Renew'**
  String get renewPlan;

  /// No description provided for @renewalExists.
  ///
  /// In en, this message translates to:
  /// **'A renewal already exists for this plan.'**
  String get renewalExists;

  /// No description provided for @addMeal.
  ///
  /// In en, this message translates to:
  /// **'Add a meal'**
  String get addMeal;

  /// No description provided for @pendingSwapPayments.
  ///
  /// In en, this message translates to:
  /// **'Swaps waiting for payment'**
  String get pendingSwapPayments;

  /// No description provided for @policies.
  ///
  /// In en, this message translates to:
  /// **'Policies'**
  String get policies;

  /// No description provided for @pausedUntil.
  ///
  /// In en, this message translates to:
  /// **'Paused until {date}'**
  String pausedUntil(Object date);

  /// No description provided for @accountTitle.
  ///
  /// In en, this message translates to:
  /// **'My account'**
  String get accountTitle;

  /// No description provided for @addresses.
  ///
  /// In en, this message translates to:
  /// **'Addresses'**
  String get addresses;

  /// No description provided for @wallet.
  ///
  /// In en, this message translates to:
  /// **'Dabba credit'**
  String get wallet;

  /// No description provided for @payments.
  ///
  /// In en, this message translates to:
  /// **'Payments'**
  String get payments;

  /// No description provided for @notifications.
  ///
  /// In en, this message translates to:
  /// **'Notifications'**
  String get notifications;

  /// No description provided for @referrals.
  ///
  /// In en, this message translates to:
  /// **'Refer a friend'**
  String get referrals;

  /// No description provided for @support.
  ///
  /// In en, this message translates to:
  /// **'Help & support'**
  String get support;

  /// No description provided for @profile.
  ///
  /// In en, this message translates to:
  /// **'Profile'**
  String get profile;

  /// No description provided for @foodPreferences.
  ///
  /// In en, this message translates to:
  /// **'Food preferences'**
  String get foodPreferences;

  /// No description provided for @notificationSettings.
  ///
  /// In en, this message translates to:
  /// **'Notification settings'**
  String get notificationSettings;

  /// No description provided for @privacy.
  ///
  /// In en, this message translates to:
  /// **'Privacy & data'**
  String get privacy;

  /// No description provided for @security.
  ///
  /// In en, this message translates to:
  /// **'Security'**
  String get security;

  /// No description provided for @makeDefault.
  ///
  /// In en, this message translates to:
  /// **'Make default'**
  String get makeDefault;

  /// No description provided for @defaultAddress.
  ///
  /// In en, this message translates to:
  /// **'Default'**
  String get defaultAddress;

  /// No description provided for @notCovered.
  ///
  /// In en, this message translates to:
  /// **'We don\'t deliver here yet'**
  String get notCovered;

  /// No description provided for @covered.
  ///
  /// In en, this message translates to:
  /// **'We deliver here'**
  String get covered;

  /// No description provided for @deleteAddressConfirm.
  ///
  /// In en, this message translates to:
  /// **'Remove this address?'**
  String get deleteAddressConfirm;

  /// No description provided for @addressLabel.
  ///
  /// In en, this message translates to:
  /// **'Label (e.g. Office)'**
  String get addressLabel;

  /// No description provided for @addressType.
  ///
  /// In en, this message translates to:
  /// **'Type'**
  String get addressType;

  /// No description provided for @recipient.
  ///
  /// In en, this message translates to:
  /// **'Recipient name'**
  String get recipient;

  /// No description provided for @placeName.
  ///
  /// In en, this message translates to:
  /// **'Building / company'**
  String get placeName;

  /// No description provided for @line1.
  ///
  /// In en, this message translates to:
  /// **'Street / house'**
  String get line1;

  /// No description provided for @area.
  ///
  /// In en, this message translates to:
  /// **'Area (e.g. Baneshwor)'**
  String get area;

  /// No description provided for @ward.
  ///
  /// In en, this message translates to:
  /// **'Ward'**
  String get ward;

  /// No description provided for @municipality.
  ///
  /// In en, this message translates to:
  /// **'Municipality'**
  String get municipality;

  /// No description provided for @city.
  ///
  /// In en, this message translates to:
  /// **'City'**
  String get city;

  /// No description provided for @landmark.
  ///
  /// In en, this message translates to:
  /// **'Landmark'**
  String get landmark;

  /// No description provided for @instructions.
  ///
  /// In en, this message translates to:
  /// **'Delivery instructions'**
  String get instructions;

  /// No description provided for @checkCoverage.
  ///
  /// In en, this message translates to:
  /// **'Check coverage'**
  String get checkCoverage;

  /// No description provided for @atHOME.
  ///
  /// In en, this message translates to:
  /// **'Home'**
  String get atHOME;

  /// No description provided for @atOFFICE.
  ///
  /// In en, this message translates to:
  /// **'Office'**
  String get atOFFICE;

  /// No description provided for @atSHOP.
  ///
  /// In en, this message translates to:
  /// **'Shop'**
  String get atSHOP;

  /// No description provided for @atCOLLEGE.
  ///
  /// In en, this message translates to:
  /// **'College'**
  String get atCOLLEGE;

  /// No description provided for @atSITE.
  ///
  /// In en, this message translates to:
  /// **'Work site'**
  String get atSITE;

  /// No description provided for @atOTHER.
  ///
  /// In en, this message translates to:
  /// **'Other'**
  String get atOTHER;

  /// No description provided for @walletBalance.
  ///
  /// In en, this message translates to:
  /// **'Balance'**
  String get walletBalance;

  /// No description provided for @walletHistory.
  ///
  /// In en, this message translates to:
  /// **'History'**
  String get walletHistory;

  /// No description provided for @topUp.
  ///
  /// In en, this message translates to:
  /// **'Add credit'**
  String get topUp;

  /// No description provided for @topUpAmount.
  ///
  /// In en, this message translates to:
  /// **'Amount (Rs)'**
  String get topUpAmount;

  /// No description provided for @topUpLimits.
  ///
  /// In en, this message translates to:
  /// **'Between {min} and {max}'**
  String topUpLimits(Object min, Object max);

  /// No description provided for @invalidAmount.
  ///
  /// In en, this message translates to:
  /// **'Enter a valid amount'**
  String get invalidAmount;

  /// No description provided for @markAllRead.
  ///
  /// In en, this message translates to:
  /// **'Mark all read'**
  String get markAllRead;

  /// No description provided for @noNotifications.
  ///
  /// In en, this message translates to:
  /// **'No notifications yet.'**
  String get noNotifications;

  /// No description provided for @yourCode.
  ///
  /// In en, this message translates to:
  /// **'Your code'**
  String get yourCode;

  /// No description provided for @friendsJoined.
  ///
  /// In en, this message translates to:
  /// **'Friends'**
  String get friendsJoined;

  /// No description provided for @rewardsEarned.
  ///
  /// In en, this message translates to:
  /// **'Rewards earned'**
  String get rewardsEarned;

  /// No description provided for @haveFriendCode.
  ///
  /// In en, this message translates to:
  /// **'Have a friend\'s code?'**
  String get haveFriendCode;

  /// No description provided for @claim.
  ///
  /// In en, this message translates to:
  /// **'Use code'**
  String get claim;

  /// No description provided for @referralsOff.
  ///
  /// In en, this message translates to:
  /// **'Referrals aren\'t running right now.'**
  String get referralsOff;

  /// No description provided for @newTicket.
  ///
  /// In en, this message translates to:
  /// **'New request'**
  String get newTicket;

  /// No description provided for @subject.
  ///
  /// In en, this message translates to:
  /// **'Subject'**
  String get subject;

  /// No description provided for @message.
  ///
  /// In en, this message translates to:
  /// **'Message'**
  String get message;

  /// No description provided for @category.
  ///
  /// In en, this message translates to:
  /// **'Topic'**
  String get category;

  /// No description provided for @send.
  ///
  /// In en, this message translates to:
  /// **'Send'**
  String get send;

  /// No description provided for @noTickets.
  ///
  /// In en, this message translates to:
  /// **'No support requests. We usually answer within a working day.'**
  String get noTickets;

  /// No description provided for @ticketClosed.
  ///
  /// In en, this message translates to:
  /// **'This conversation is closed. Open a new request if you need more help.'**
  String get ticketClosed;

  /// No description provided for @replyHint.
  ///
  /// In en, this message translates to:
  /// **'Write a reply'**
  String get replyHint;

  /// No description provided for @tcORDER.
  ///
  /// In en, this message translates to:
  /// **'Order'**
  String get tcORDER;

  /// No description provided for @tcPAYMENT.
  ///
  /// In en, this message translates to:
  /// **'Payment'**
  String get tcPAYMENT;

  /// No description provided for @tcDELIVERY.
  ///
  /// In en, this message translates to:
  /// **'Delivery'**
  String get tcDELIVERY;

  /// No description provided for @tcFOOD.
  ///
  /// In en, this message translates to:
  /// **'Food'**
  String get tcFOOD;

  /// No description provided for @tcACCOUNT.
  ///
  /// In en, this message translates to:
  /// **'Account'**
  String get tcACCOUNT;

  /// No description provided for @tcCORPORATE.
  ///
  /// In en, this message translates to:
  /// **'Company'**
  String get tcCORPORATE;

  /// No description provided for @tcGENERAL.
  ///
  /// In en, this message translates to:
  /// **'Something else'**
  String get tcGENERAL;

  /// No description provided for @marketingOptIn.
  ///
  /// In en, this message translates to:
  /// **'Send me new menus and offers'**
  String get marketingOptIn;

  /// No description provided for @phoneChangeNote.
  ///
  /// In en, this message translates to:
  /// **'Changing your number means verifying it again.'**
  String get phoneChangeNote;

  /// No description provided for @diet.
  ///
  /// In en, this message translates to:
  /// **'Diet'**
  String get diet;

  /// No description provided for @dietANY.
  ///
  /// In en, this message translates to:
  /// **'Anything'**
  String get dietANY;

  /// No description provided for @dietEGG_OK.
  ///
  /// In en, this message translates to:
  /// **'Veg + egg'**
  String get dietEGG_OK;

  /// No description provided for @spiceTolerance.
  ///
  /// In en, this message translates to:
  /// **'Spice tolerance'**
  String get spiceTolerance;

  /// No description provided for @myAllergies.
  ///
  /// In en, this message translates to:
  /// **'My allergies (printed on your dabba label)'**
  String get myAllergies;

  /// No description provided for @avoidOnionGarlic.
  ///
  /// In en, this message translates to:
  /// **'Avoid onion & garlic'**
  String get avoidOnionGarlic;

  /// No description provided for @dietaryNotes.
  ///
  /// In en, this message translates to:
  /// **'Notes for the kitchen'**
  String get dietaryNotes;

  /// No description provided for @ntORDER_UPDATES.
  ///
  /// In en, this message translates to:
  /// **'Order updates'**
  String get ntORDER_UPDATES;

  /// No description provided for @ntPLAN_REMINDERS.
  ///
  /// In en, this message translates to:
  /// **'Plan reminders'**
  String get ntPLAN_REMINDERS;

  /// No description provided for @ntMARKETING.
  ///
  /// In en, this message translates to:
  /// **'Menus & offers'**
  String get ntMARKETING;

  /// No description provided for @chIN_APP.
  ///
  /// In en, this message translates to:
  /// **'In app'**
  String get chIN_APP;

  /// No description provided for @chEMAIL.
  ///
  /// In en, this message translates to:
  /// **'Email'**
  String get chEMAIL;

  /// No description provided for @chSMS.
  ///
  /// In en, this message translates to:
  /// **'SMS'**
  String get chSMS;

  /// No description provided for @exportData.
  ///
  /// In en, this message translates to:
  /// **'Download my data'**
  String get exportData;

  /// No description provided for @exportDataBody.
  ///
  /// In en, this message translates to:
  /// **'Everything we hold about you, as JSON you can save or share.'**
  String get exportDataBody;

  /// No description provided for @deleteAccount.
  ///
  /// In en, this message translates to:
  /// **'Ask to delete my account'**
  String get deleteAccount;

  /// No description provided for @deleteAccountBody.
  ///
  /// In en, this message translates to:
  /// **'Our team reviews deletion requests. Open orders, credit and invoices are settled first. Type DELETE to confirm.'**
  String get deleteAccountBody;

  /// No description provided for @privacyRequests.
  ///
  /// In en, this message translates to:
  /// **'My requests'**
  String get privacyRequests;

  /// No description provided for @typeDelete.
  ///
  /// In en, this message translates to:
  /// **'Type DELETE'**
  String get typeDelete;

  /// No description provided for @riderRoutesTitle.
  ///
  /// In en, this message translates to:
  /// **'My routes'**
  String get riderRoutesTitle;

  /// No description provided for @riderNoRoutes.
  ///
  /// In en, this message translates to:
  /// **'No routes for this day.'**
  String get riderNoRoutes;

  /// No description provided for @riderStopsProgress.
  ///
  /// In en, this message translates to:
  /// **'{done} of {total} stops done'**
  String riderStopsProgress(int done, int total);

  /// No description provided for @riderCashCollected.
  ///
  /// In en, this message translates to:
  /// **'Cash collected: {amount}'**
  String riderCashCollected(Object amount);

  /// No description provided for @riderReadOnly.
  ///
  /// In en, this message translates to:
  /// **'View only — this route can\'t be changed from here.'**
  String get riderReadOnly;

  /// No description provided for @riderRouteCount.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =0{No routes} =1{1 route} other{{count} routes}}'**
  String riderRouteCount(int count);

  /// No description provided for @riderStop.
  ///
  /// In en, this message translates to:
  /// **'Stop {n}'**
  String riderStop(int n);

  /// No description provided for @riderDeliver.
  ///
  /// In en, this message translates to:
  /// **'Delivered'**
  String get riderDeliver;

  /// No description provided for @riderFail.
  ///
  /// In en, this message translates to:
  /// **'Couldn\'t deliver'**
  String get riderFail;

  /// No description provided for @riderFinishRoute.
  ///
  /// In en, this message translates to:
  /// **'Finish route'**
  String get riderFinishRoute;

  /// No description provided for @riderFinishConfirm.
  ///
  /// In en, this message translates to:
  /// **'Finish this route? Make sure every stop is delivered or marked failed.'**
  String get riderFinishConfirm;

  /// No description provided for @riderRouteFinished.
  ///
  /// In en, this message translates to:
  /// **'Route finished.'**
  String get riderRouteFinished;

  /// No description provided for @riderOpenStops.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =1{1 stop still out} other{{count} stops still out}}'**
  String riderOpenStops(int count);

  /// No description provided for @riderDeliverTitle.
  ///
  /// In en, this message translates to:
  /// **'Mark {number} delivered'**
  String riderDeliverTitle(Object number);

  /// No description provided for @riderOtpLabel.
  ///
  /// In en, this message translates to:
  /// **'Customer\'s 4-digit code'**
  String get riderOtpLabel;

  /// No description provided for @riderOtpHelp.
  ///
  /// In en, this message translates to:
  /// **'Ask the customer for the code shown in their app or SMS.'**
  String get riderOtpHelp;

  /// No description provided for @riderOtpInvalid.
  ///
  /// In en, this message translates to:
  /// **'Enter the 4-digit code'**
  String get riderOtpInvalid;

  /// No description provided for @riderCollect.
  ///
  /// In en, this message translates to:
  /// **'Collect {amount} in cash'**
  String riderCollect(Object amount);

  /// No description provided for @riderCashLabel.
  ///
  /// In en, this message translates to:
  /// **'Cash collected (Rs)'**
  String get riderCashLabel;

  /// No description provided for @riderCashMismatch.
  ///
  /// In en, this message translates to:
  /// **'Must be exactly {amount}'**
  String riderCashMismatch(Object amount);

  /// No description provided for @riderPhoto.
  ///
  /// In en, this message translates to:
  /// **'Delivery photo'**
  String get riderPhoto;

  /// No description provided for @riderPhotoRequired.
  ///
  /// In en, this message translates to:
  /// **'A photo of the delivered dabba is required.'**
  String get riderPhotoRequired;

  /// No description provided for @riderTakePhoto.
  ///
  /// In en, this message translates to:
  /// **'Take photo'**
  String get riderTakePhoto;

  /// No description provided for @riderChoosePhoto.
  ///
  /// In en, this message translates to:
  /// **'Choose photo'**
  String get riderChoosePhoto;

  /// No description provided for @riderRemovePhoto.
  ///
  /// In en, this message translates to:
  /// **'Remove photo'**
  String get riderRemovePhoto;

  /// No description provided for @riderDelivered.
  ///
  /// In en, this message translates to:
  /// **'{number} delivered.'**
  String riderDelivered(Object number);

  /// No description provided for @riderFailTitle.
  ///
  /// In en, this message translates to:
  /// **'Why couldn\'t you deliver?'**
  String get riderFailTitle;

  /// No description provided for @riderFailDetail.
  ///
  /// In en, this message translates to:
  /// **'What happened?'**
  String get riderFailDetail;

  /// No description provided for @riderFailed.
  ///
  /// In en, this message translates to:
  /// **'{number} marked failed.'**
  String riderFailed(Object number);

  /// No description provided for @riderAllergen.
  ///
  /// In en, this message translates to:
  /// **'Allergy note'**
  String get riderAllergen;

  /// No description provided for @riderInstructions.
  ///
  /// In en, this message translates to:
  /// **'Instructions'**
  String get riderInstructions;

  /// No description provided for @riderPrepaid.
  ///
  /// In en, this message translates to:
  /// **'Paid — nothing to collect'**
  String get riderPrepaid;

  /// No description provided for @riderCantOpen.
  ///
  /// In en, this message translates to:
  /// **'Couldn\'t open that app on this phone.'**
  String get riderCantOpen;

  /// No description provided for @kitchenProduction.
  ///
  /// In en, this message translates to:
  /// **'Production'**
  String get kitchenProduction;

  /// No description provided for @kitchenBatches.
  ///
  /// In en, this message translates to:
  /// **'Batches'**
  String get kitchenBatches;

  /// No description provided for @kitchenQc.
  ///
  /// In en, this message translates to:
  /// **'QC log'**
  String get kitchenQc;

  /// No description provided for @kitchenAlerts.
  ///
  /// In en, this message translates to:
  /// **'Stock alerts'**
  String get kitchenAlerts;

  /// No description provided for @kitchenOrders.
  ///
  /// In en, this message translates to:
  /// **'Orders'**
  String get kitchenOrders;

  /// No description provided for @kitchenMeals.
  ///
  /// In en, this message translates to:
  /// **'Meals'**
  String get kitchenMeals;

  /// No description provided for @kitchenPendingPayment.
  ///
  /// In en, this message translates to:
  /// **'Payment pending'**
  String get kitchenPendingPayment;

  /// No description provided for @kitchenAllergenFlagged.
  ///
  /// In en, this message translates to:
  /// **'Allergy flags'**
  String get kitchenAllergenFlagged;

  /// No description provided for @kitchenByDabba.
  ///
  /// In en, this message translates to:
  /// **'By dabba'**
  String get kitchenByDabba;

  /// No description provided for @kitchenBySlot.
  ///
  /// In en, this message translates to:
  /// **'By delivery slot'**
  String get kitchenBySlot;

  /// No description provided for @kitchenDishes.
  ///
  /// In en, this message translates to:
  /// **'Dishes to cook'**
  String get kitchenDishes;

  /// No description provided for @kitchenPortions.
  ///
  /// In en, this message translates to:
  /// **'{portions} + {buffer} buffer = {total}'**
  String kitchenPortions(int portions, int buffer, int total);

  /// No description provided for @kitchenStartPreparing.
  ///
  /// In en, this message translates to:
  /// **'Start preparing'**
  String get kitchenStartPreparing;

  /// No description provided for @kitchenPack.
  ///
  /// In en, this message translates to:
  /// **'Pack'**
  String get kitchenPack;

  /// No description provided for @kitchenPackChecksTitle.
  ///
  /// In en, this message translates to:
  /// **'Packing checks'**
  String get kitchenPackChecksTitle;

  /// No description provided for @kitchenPackChecksBody.
  ///
  /// In en, this message translates to:
  /// **'Confirm for each selected order:'**
  String get kitchenPackChecksBody;

  /// No description provided for @kitchenCheckItems.
  ///
  /// In en, this message translates to:
  /// **'Items match the ticket'**
  String get kitchenCheckItems;

  /// No description provided for @kitchenCheckLabel.
  ///
  /// In en, this message translates to:
  /// **'Label is on the dabba'**
  String get kitchenCheckLabel;

  /// No description provided for @kitchenCheckAllergen.
  ///
  /// In en, this message translates to:
  /// **'Allergy notes respected'**
  String get kitchenCheckAllergen;

  /// No description provided for @kitchenCheckSealed.
  ///
  /// In en, this message translates to:
  /// **'Sealed'**
  String get kitchenCheckSealed;

  /// No description provided for @kitchenChanged.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =1{1 order updated} other{{count} orders updated}}'**
  String kitchenChanged(int count);

  /// No description provided for @kitchenRejected.
  ///
  /// In en, this message translates to:
  /// **'Not changed:'**
  String get kitchenRejected;

  /// No description provided for @kitchenSelectOrders.
  ///
  /// In en, this message translates to:
  /// **'Select orders to act on them in bulk.'**
  String get kitchenSelectOrders;

  /// No description provided for @kitchenNoOrders.
  ///
  /// In en, this message translates to:
  /// **'No orders for this kitchen-day.'**
  String get kitchenNoOrders;

  /// No description provided for @kitchenPlanBatches.
  ///
  /// In en, this message translates to:
  /// **'Plan batches from forecast'**
  String get kitchenPlanBatches;

  /// No description provided for @kitchenPlanned.
  ///
  /// In en, this message translates to:
  /// **'{created} created, {updated} updated'**
  String kitchenPlanned(int created, int updated);

  /// No description provided for @kitchenNoBatches.
  ///
  /// In en, this message translates to:
  /// **'No batches yet. Plan them from the forecast.'**
  String get kitchenNoBatches;

  /// No description provided for @kitchenBatchPortions.
  ///
  /// In en, this message translates to:
  /// **'{planned} planned (+{buffer} buffer)'**
  String kitchenBatchPortions(int planned, int buffer);

  /// No description provided for @kitchenStartCooking.
  ///
  /// In en, this message translates to:
  /// **'Start cooking'**
  String get kitchenStartCooking;

  /// No description provided for @kitchenMarkDone.
  ///
  /// In en, this message translates to:
  /// **'Mark done'**
  String get kitchenMarkDone;

  /// No description provided for @kitchenCancelBatch.
  ///
  /// In en, this message translates to:
  /// **'Cancel batch'**
  String get kitchenCancelBatch;

  /// No description provided for @kitchenActualPortions.
  ///
  /// In en, this message translates to:
  /// **'Actual portions'**
  String get kitchenActualPortions;

  /// No description provided for @kitchenWastePortions.
  ///
  /// In en, this message translates to:
  /// **'Wasted portions'**
  String get kitchenWastePortions;

  /// No description provided for @kitchenShortages.
  ///
  /// In en, this message translates to:
  /// **'Stock shortages'**
  String get kitchenShortages;

  /// No description provided for @kitchenLogQc.
  ///
  /// In en, this message translates to:
  /// **'Log a check'**
  String get kitchenLogQc;

  /// No description provided for @kitchenQcType.
  ///
  /// In en, this message translates to:
  /// **'Check'**
  String get kitchenQcType;

  /// No description provided for @kitchenQcValue.
  ///
  /// In en, this message translates to:
  /// **'Reading (e.g. 68°C)'**
  String get kitchenQcValue;

  /// No description provided for @kitchenQcPass.
  ///
  /// In en, this message translates to:
  /// **'Pass'**
  String get kitchenQcPass;

  /// No description provided for @kitchenQcFail.
  ///
  /// In en, this message translates to:
  /// **'Fail'**
  String get kitchenQcFail;

  /// No description provided for @kitchenQcNoteRequired.
  ///
  /// In en, this message translates to:
  /// **'A failed check needs a note.'**
  String get kitchenQcNoteRequired;

  /// No description provided for @kitchenNoQc.
  ///
  /// In en, this message translates to:
  /// **'No checks logged for this day.'**
  String get kitchenNoQc;

  /// No description provided for @kitchenNoAlerts.
  ///
  /// In en, this message translates to:
  /// **'No stock alerts. All good.'**
  String get kitchenNoAlerts;

  /// No description provided for @qcTEMPERATURE.
  ///
  /// In en, this message translates to:
  /// **'Temperature'**
  String get qcTEMPERATURE;

  /// No description provided for @qcTASTE.
  ///
  /// In en, this message translates to:
  /// **'Taste'**
  String get qcTASTE;

  /// No description provided for @qcHYGIENE.
  ///
  /// In en, this message translates to:
  /// **'Hygiene'**
  String get qcHYGIENE;

  /// No description provided for @qcPACKAGING.
  ///
  /// In en, this message translates to:
  /// **'Packaging'**
  String get qcPACKAGING;

  /// No description provided for @qcOTHER.
  ///
  /// In en, this message translates to:
  /// **'Other'**
  String get qcOTHER;

  /// No description provided for @dispatchBoard.
  ///
  /// In en, this message translates to:
  /// **'Board'**
  String get dispatchBoard;

  /// No description provided for @dispatchRoutes.
  ///
  /// In en, this message translates to:
  /// **'Routes'**
  String get dispatchRoutes;

  /// No description provided for @dispatchFailed.
  ///
  /// In en, this message translates to:
  /// **'Failed'**
  String get dispatchFailed;

  /// No description provided for @dispatchHandOffPoints.
  ///
  /// In en, this message translates to:
  /// **'Hand-off points'**
  String get dispatchHandOffPoints;

  /// No description provided for @dispatchUnrouted.
  ///
  /// In en, this message translates to:
  /// **'Unrouted'**
  String get dispatchUnrouted;

  /// No description provided for @dispatchOut.
  ///
  /// In en, this message translates to:
  /// **'Out'**
  String get dispatchOut;

  /// No description provided for @dispatchChanged.
  ///
  /// In en, this message translates to:
  /// **'Changed after routing'**
  String get dispatchChanged;

  /// No description provided for @dispatchManifest.
  ///
  /// In en, this message translates to:
  /// **'Manifest (slot × zone)'**
  String get dispatchManifest;

  /// No description provided for @dispatchUnroutedOrders.
  ///
  /// In en, this message translates to:
  /// **'Unrouted orders'**
  String get dispatchUnroutedOrders;

  /// No description provided for @dispatchAllRouted.
  ///
  /// In en, this message translates to:
  /// **'Every order is on a route.'**
  String get dispatchAllRouted;

  /// No description provided for @dispatchCreateRoute.
  ///
  /// In en, this message translates to:
  /// **'New route'**
  String get dispatchCreateRoute;

  /// No description provided for @dispatchAddToRoute.
  ///
  /// In en, this message translates to:
  /// **'Add to route'**
  String get dispatchAddToRoute;

  /// No description provided for @dispatchAutoGroup.
  ///
  /// In en, this message translates to:
  /// **'Auto-group'**
  String get dispatchAutoGroup;

  /// No description provided for @dispatchAutoGroupConfirm.
  ///
  /// In en, this message translates to:
  /// **'Put every unrouted order on one route per slot × zone?'**
  String get dispatchAutoGroupConfirm;

  /// No description provided for @dispatchAutoGrouped.
  ///
  /// In en, this message translates to:
  /// **'{routes} routes, {stops} stops'**
  String dispatchAutoGrouped(int routes, int stops);

  /// No description provided for @dispatchRouteName.
  ///
  /// In en, this message translates to:
  /// **'Route name'**
  String get dispatchRouteName;

  /// No description provided for @dispatchSlot.
  ///
  /// In en, this message translates to:
  /// **'Delivery slot'**
  String get dispatchSlot;

  /// No description provided for @dispatchZone.
  ///
  /// In en, this message translates to:
  /// **'Zone'**
  String get dispatchZone;

  /// No description provided for @dispatchRider.
  ///
  /// In en, this message translates to:
  /// **'Rider'**
  String get dispatchRider;

  /// No description provided for @dispatchNone.
  ///
  /// In en, this message translates to:
  /// **'None'**
  String get dispatchNone;

  /// No description provided for @dispatchNoRider.
  ///
  /// In en, this message translates to:
  /// **'No rider yet'**
  String get dispatchNoRider;

  /// No description provided for @dispatchAssignRider.
  ///
  /// In en, this message translates to:
  /// **'Assign rider'**
  String get dispatchAssignRider;

  /// No description provided for @dispatchUnavailable.
  ///
  /// In en, this message translates to:
  /// **'busy'**
  String get dispatchUnavailable;

  /// No description provided for @dispatchStart.
  ///
  /// In en, this message translates to:
  /// **'Dispatch'**
  String get dispatchStart;

  /// No description provided for @dispatchComplete.
  ///
  /// In en, this message translates to:
  /// **'Close route'**
  String get dispatchComplete;

  /// No description provided for @dispatchStarted.
  ///
  /// In en, this message translates to:
  /// **'{out} out for delivery, {notPacked} not packed yet'**
  String dispatchStarted(int out, int notPacked);

  /// No description provided for @dispatchRemoveStop.
  ///
  /// In en, this message translates to:
  /// **'Take off route'**
  String get dispatchRemoveStop;

  /// No description provided for @dispatchNoRoutes.
  ///
  /// In en, this message translates to:
  /// **'No routes yet for this day.'**
  String get dispatchNoRoutes;

  /// No description provided for @dispatchCashExpected.
  ///
  /// In en, this message translates to:
  /// **'Cash {collected} of {expected}'**
  String dispatchCashExpected(Object collected, Object expected);

  /// No description provided for @dispatchNoFailed.
  ///
  /// In en, this message translates to:
  /// **'No failed deliveries for this day.'**
  String get dispatchNoFailed;

  /// No description provided for @dispatchRetry.
  ///
  /// In en, this message translates to:
  /// **'Retry delivery'**
  String get dispatchRetry;

  /// No description provided for @dispatchCancelCredit.
  ///
  /// In en, this message translates to:
  /// **'Cancel + credit'**
  String get dispatchCancelCredit;

  /// No description provided for @dispatchCancelCreditBody.
  ///
  /// In en, this message translates to:
  /// **'Cancel this order and credit the customer\'s wallet.'**
  String get dispatchCancelCreditBody;

  /// No description provided for @dispatchResolved.
  ///
  /// In en, this message translates to:
  /// **'{number} updated.'**
  String dispatchResolved(Object number);

  /// No description provided for @dispatchPickRoute.
  ///
  /// In en, this message translates to:
  /// **'Choose a route'**
  String get dispatchPickRoute;

  /// No description provided for @dispatchFailedReason.
  ///
  /// In en, this message translates to:
  /// **'Last reason: {reason}'**
  String dispatchFailedReason(Object reason);

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
