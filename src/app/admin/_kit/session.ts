"use server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/server/auth";

export async function signOutAction() {
  try {
    await auth.api.signOut({ headers: await headers() });
  } catch {
    /* already signed out */
  }
  redirect("/login");
}
