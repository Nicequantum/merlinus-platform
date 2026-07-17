export {
  MODULE_CATALOG,
  PRODUCT_MODULE_IDS,
  getModuleCatalogEntry,
  isProductModuleId,
  parseForcedModules,
  type ModuleCatalogEntry,
  type ProductModuleId,
} from '@/lib/modules/catalog';

export {
  ModuleDisabledError,
  assertModuleEnabled,
  isModuleEnabled,
  listModuleStatuses,
  resolveModuleStatus,
  type ModuleSource,
  type ModuleStatus,
} from '@/lib/modules/entitlements';
