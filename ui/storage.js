const STORAGE_KEY = "modSettings";

export const Storage = new (class {
  // Read and parse the mod settings blob from localStorage.
  readAll() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    } catch (e) {
      console.error(`ModSettings: error loading settings`);
      console.error(`${STORAGE_KEY}: ${e}`);
    }
    return {};
  }

  // Persist the full mod settings blob back to localStorage.
  writeAll(modSettings) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(modSettings));
  }

  set(key, value) {
    // Read the existing settings without touching unrelated localStorage keys.
    const modSettings = this.readAll();

    // Overwrite only the requested setting.
    modSettings[key] = value;

    // Save the updated settings blob back to localStorage.
    this.writeAll(modSettings);

    // Keep the existing debug logging behavior.
    console.warn(`SAVE ${key}=${JSON.stringify(value)}`);
  }

  // Save one setting without spamming the mirrored debug console.
  setQuietly(key, value) {
    const modSettings = this.readAll();
    modSettings[key] = value;
    this.writeAll(modSettings);
  }

  get(key) {
    // Read the full settings blob and return just the requested value.
    const modSettings = this.readAll();

    // Normalize missing keys to null so callers have a consistent contract.
    return modSettings[key] ?? null;
  }
})();
