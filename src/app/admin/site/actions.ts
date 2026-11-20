"use server";

import { done, fail, type ActionResult } from "@/lib/action";
import type { CurrentUser } from "@/lib/auth";
import type { Permission } from "@/lib/permissions";
import { CmsError } from "@/lib/cms/access";
import { deleteNavItem, moveNavItem, saveNavItem, setNavVisible } from "@/lib/cms/nav";
import { deleteRedirect, saveRedirect } from "@/lib/cms/redirects";
import { saveBranding, type ColorPreset, type FontPreset } from "@/lib/cms/branding";
import { guarded } from "../_kit/guard";
import { f } from "../_kit/form";

async function run(perm: Permission, fn: (user: CurrentUser) => Promise<ActionResult>) {
  return guarded(
    perm,
    async (user) => {
      try {
        return await fn(user);
      } catch (e) {
        if (e instanceof CmsError) return fail(e.message.startsWith("FORBIDDEN") ? "You don't have permission for that" : e.message);
        throw e;
      }
    },
    ["/admin/site"],
  );
}

export async function saveNavAction(id: string | null, _prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return run("content.publish", async (user) => {
    await saveNavItem(user, id, {
      menu: f.str(fd, "menu", 40),
      label: f.str(fd, "label", 60),
      labelNe: f.opt(fd, "labelNe", 60),
      href: f.str(fd, "href", 500),
      parentId: f.opt(fd, "parentId", 40),
      visible: id ? f.bool(fd, "visible") : true,
    });
    return done(id ? "Link saved — live now" : "Link added — live now");
  });
}

export async function deleteNavAction(id: string): Promise<ActionResult> {
  return run("content.publish", async (user) => {
    await deleteNavItem(user, id);
    return done("Link removed");
  });
}

export async function moveNavAction(id: string, by: -1 | 1): Promise<ActionResult> {
  return run("content.publish", async (user) => {
    await moveNavItem(user, id, by);
    return done("Moved");
  });
}

export async function toggleNavAction(id: string, visible: boolean): Promise<ActionResult> {
  return run("content.publish", async (user) => {
    await setNavVisible(user, id, visible);
    return done(visible ? "Shown" : "Hidden");
  });
}

export async function saveRedirectAction(id: string | null, _prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return run("seo.edit", async (user) => {
    await saveRedirect(user, id, { from: f.str(fd, "from", 300), to: f.str(fd, "to", 500), permanent: f.str(fd, "kind") !== "temporary" });
    return done("Redirect saved");
  });
}

export async function deleteRedirectAction(id: string): Promise<ActionResult> {
  return run("seo.edit", async (user) => {
    await deleteRedirect(user, id);
    return done("Redirect removed");
  });
}

export async function saveBrandingAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return run("content.publish", async (user) => {
    await saveBranding(user, {
      logoUrl: f.str(fd, "logoUrl", 500),
      logoLightUrl: f.str(fd, "logoLightUrl", 500),
      faviconUrl: f.str(fd, "faviconUrl", 500),
      colorPreset: f.str(fd, "colorPreset", 20) as ColorPreset,
      fontPreset: f.str(fd, "fontPreset", 20) as FontPreset,
      contact: {
        phone: f.str(fd, "phone", 40),
        whatsapp: f.str(fd, "whatsapp", 40),
        email: f.str(fd, "email", 200),
        address: f.str(fd, "address", 300),
        hours: f.str(fd, "hours", 200),
        facebook: f.str(fd, "facebook", 300),
        instagram: f.str(fd, "instagram", 300),
        tiktok: f.str(fd, "tiktok", 300),
      },
    });
    return done("Branding saved — live now");
  });
}
