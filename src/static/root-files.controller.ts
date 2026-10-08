import { join } from "node:path";
import { Controller, Get, HttpException, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { cacheHeaders, type CacheProfileName } from "../http/cache-profiles.js";
import {
  sendStaticFile,
  STATIC_ROOT,
  statRegularFile,
} from "./static-files.js";

async function sendRootFile(
  req: Request,
  res: Response,
  relativePath: string,
  profile: CacheProfileName,
): Promise<void> {
  const file = await statRegularFile(join(STATIC_ROOT, relativePath));
  if (file === undefined) {
    throw new HttpException({ detail: "File not found" }, 404);
  }
  await sendStaticFile(req, res, file, {
    ...cacheHeaders(profile),
    "Cache-Tag": "static-files",
  });
}

@Controller()
export class RootFilesController {
  @Get("favicon.ico")
  favicon(@Req() req: Request, @Res() res: Response): Promise<void> {
    return sendRootFile(req, res, "images/favicon.ico", "STATIC_MEDIA");
  }

  @Get("robots.txt")
  robots(@Req() req: Request, @Res() res: Response): Promise<void> {
    return sendRootFile(req, res, "robots.txt", "STATIC_TEXT");
  }

  @Get("sitemap.xml")
  sitemap(@Req() req: Request, @Res() res: Response): Promise<void> {
    return sendRootFile(req, res, "sitemap.xml", "STATIC_TEXT");
  }
}
