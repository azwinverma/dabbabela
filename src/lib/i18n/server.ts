import "server-only";
import { cookies } from "next/headers";
import { cache } from "react";
import { dict, isLocale, LOCALE_COOKIE, type Locale } from "./index";

export const getLocale = cache(async (): Promise<Locale> => {
  const v = (await cookies()).get(LOCALE_COOKIE)?.value;
  return isLocale(v) ? v : "en";
});

export async function getI18n() {
  const locale = await getLocale();
  return { locale, t: dict(locale) };
}
