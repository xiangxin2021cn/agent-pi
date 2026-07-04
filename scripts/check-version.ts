type PackageJson = {
  name?: string
  version?: string
}

const rootPackagePath = 'package.json'
const electronPackagePath = 'apps/electron/package.json'
const semverPattern = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/

async function readPackageJson(path: string): Promise<PackageJson> {
  try {
    return JSON.parse(await Bun.file(path).text()) as PackageJson
  } catch (error) {
    throw new Error(`Unable to read ${path}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

const rootPackage = await readPackageJson(rootPackagePath)
const electronPackage = await readPackageJson(electronPackagePath)

if (!rootPackage.version || !semverPattern.test(rootPackage.version)) {
  throw new Error(`${rootPackagePath} has an invalid version: ${rootPackage.version ?? '(missing)'}`)
}

if (!electronPackage.version || !semverPattern.test(electronPackage.version)) {
  throw new Error(`${electronPackagePath} has an invalid version: ${electronPackage.version ?? '(missing)'}`)
}

if (rootPackage.version !== electronPackage.version) {
  throw new Error(`Version mismatch: ${rootPackagePath}=${rootPackage.version}, ${electronPackagePath}=${electronPackage.version}`)
}

console.log(`Version OK: ${rootPackage.version}`)
