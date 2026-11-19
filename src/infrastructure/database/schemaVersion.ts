/**
 * Current IndexedDB schema version (the highest `this.version(n)` in OrbitalDatabase).
 * The desktop build records it in Data/state.json to detect upgrades (verified copy of
 * the database first) and to refuse running an older program on newer data.
 */
export const DB_SCHEMA_VERSION = 2;
