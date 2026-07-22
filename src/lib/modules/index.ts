export {
  DEFERRED_MODULE_IDS,
  MODULE_CATALOG,
  MODULE_ENV_ALIASES,
  PRODUCT_MODULE_IDS,
  SEED_ENABLED_MODULE_IDS,
  PROVISION_DEFAULT_MODULE_IDS,
  DEMO_SEED_MODULE_IDS,
  VOICE_DEPARTMENT_MODULE_IDS,
  VOICE_DEPARTMENT_TO_MODULE,
  VOICE_DEPARTMENT_DOMAIN_MODULE,
  voiceDepartmentFromModuleId,
  getModuleCatalogEntry,
  isProductModuleId,
  parseForcedModules,
  type ModuleCatalogEntry,
  type ProductModuleId,
  type VoiceDepartmentId,
  type VoiceDepartmentModuleId,
} from '@/lib/modules/catalog';

export {
  ModuleDisabledError,
  assertModuleEnabled,
  assertVoiceDepartmentEnabled,
  ensureAllDealershipModuleDefaults,
  ensureDealershipModuleDefaults,
  isModuleEnabled,
  isVoiceDepartmentEnabled,
  isVoiceDepartmentModuleId,
  listModuleStatuses,
  resolveModuleStatus,
  setDealershipModuleEnabled,
  type EnsureModuleDefaultsResult,
  type ModuleSource,
  type ModuleStatus,
  type SetDealershipModuleResult,
} from '@/lib/modules/entitlements';

export {
  parseModulesForceEnableDetailed,
  validateProductModuleEnvironment,
  type ModuleEnvValidationResult,
} from '@/lib/modules/envValidation';
