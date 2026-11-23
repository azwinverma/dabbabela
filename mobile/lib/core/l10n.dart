import 'package:flutter/widgets.dart';

import '../l10n/gen/app_localizations.dart';

export '../l10n/gen/app_localizations.dart';

extension L10nContext on BuildContext {
  AppLocalizations get l10n => AppLocalizations.of(this);

  /// 'en' or 'ne' — for money/date formatting.
  String get lang => Localizations.localeOf(this).languageCode == 'ne' ? 'ne' : 'en';
}

/// Localised labels for API enum codes; unknown codes fall back to a readable version of the code.
extension CodeLabels on AppLocalizations {
  String statusLabel(String code) {
    switch (code) {
      case 'PENDING_PAYMENT':
        return stPENDING_PAYMENT;
      case 'SCHEDULED':
        return stSCHEDULED;
      case 'CONFIRMED':
        return stCONFIRMED;
      case 'PREPARING':
        return stPREPARING;
      case 'PACKED':
        return stPACKED;
      case 'OUT_FOR_DELIVERY':
        return stOUT_FOR_DELIVERY;
      case 'DELIVERED':
        return stDELIVERED;
      case 'FAILED_DELIVERY':
        return stFAILED_DELIVERY;
      case 'CANCELLED':
        return stCANCELLED;
      case 'SKIPPED':
        return stSKIPPED;
      case 'PENDING':
        return stPENDING;
      case 'PAID':
        return stPAID;
      case 'FAILED':
        return stFAILED;
      case 'REFUNDED':
        return stREFUNDED;
      case 'PARTIALLY_REFUNDED':
        return stPARTIALLY_REFUNDED;
      case 'ACTIVE':
        return stACTIVE;
      case 'PAUSED':
        return stPAUSED;
      case 'COMPLETED':
        return stCOMPLETED;
      case 'PLANNED':
        return stPLANNED;
      case 'OUT':
        return stOUT;
      case 'DONE':
        return stDONE;
      case 'COOKING':
        return stCOOKING;
      case 'OPEN':
        return stOPEN;
      case 'RESOLVED':
        return stRESOLVED;
      case 'CLOSED':
        return stCLOSED;
      case 'REJECTED':
        return stREJECTED;
    }
    return humanize(code);
  }

  String paymentMethod(String code) {
    switch (code) {
      case 'ESEWA':
        return pmESEWA;
      case 'KHALTI':
        return pmKHALTI;
      case 'BANK_TRANSFER':
        return pmBANK_TRANSFER;
      case 'CASH':
        return pmCASH;
      case 'COMPANY_INVOICE':
        return pmCOMPANY_INVOICE;
      case 'WALLET':
        return pmWALLET;
    }
    return humanize(code);
  }

  String weekday(String code) {
    switch (code) {
      case 'SUN':
        return daySUN;
      case 'MON':
        return dayMON;
      case 'TUE':
        return dayTUE;
      case 'WED':
        return dayWED;
      case 'THU':
        return dayTHU;
      case 'FRI':
        return dayFRI;
      case 'SAT':
        return daySAT;
    }
    return code;
  }

  String dietLabel(String code) {
    switch (code) {
      case 'VEG':
        return dietVEG;
      case 'VEGAN':
        return dietVEGAN;
      case 'EGG':
        return dietEGG;
    }
    return code.isEmpty ? '' : dietNONVEG;
  }
}

/// "OUT_FOR_DELIVERY" → "Out for delivery".
String humanize(String code) {
  if (code.isEmpty) return code;
  final s = code.replaceAll('_', ' ').toLowerCase();
  return s[0].toUpperCase() + s.substring(1);
}
