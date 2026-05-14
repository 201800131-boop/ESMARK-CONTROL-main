const path = require("path");

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== "win32") {
    return;
  }

  const { rcedit } = await import("rcedit");
  const appInfo = context.packager.appInfo;
  const exePath = path.join(context.appOutDir, `${appInfo.productFilename}.exe`);
  const iconPath = path.join(context.packager.projectDir, "public", "app-icon.ico");

  await rcedit(exePath, {
    icon: iconPath,
    "file-version": appInfo.shortVersion,
    "product-version": appInfo.shortVersion,
    "requested-execution-level": "asInvoker",
    "version-string": {
      CompanyName: "ESMARK",
      FileDescription: appInfo.productName,
      InternalName: appInfo.productFilename,
      LegalCopyright: appInfo.copyright,
      OriginalFilename: `${appInfo.productFilename}.exe`,
      ProductName: appInfo.productName,
    },
  });
};
