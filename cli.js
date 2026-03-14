#!/usr/bin/env node
"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// src/cli/init.ts
var import_fs3 = require("fs");
var import_path4 = require("path");

// src/cli/detect-project.ts
var import_fs = require("fs");
var import_path = require("path");
var DETECTION_RULES = [
  {
    indicators: [
      { type: "extension", pattern: ".csproj" },
      { type: "extension", pattern: ".sln" },
      { type: "file", pattern: "Directory.Build.props" }
    ],
    language: "csharp",
    framework: "dotnet",
    skills: [
      "enforcing-csharp-standards",
      "enforcing-dotnet-testing",
      "reviewing-csharp-code",
      "verifying-release-builds"
    ]
  },
  {
    indicators: [
      { type: "file", pattern: "next.config.js" },
      { type: "file", pattern: "next.config.ts" },
      { type: "file", pattern: "next.config.mjs" }
    ],
    language: "typescript",
    framework: "nextjs",
    skills: []
  },
  {
    indicators: [{ type: "file", pattern: "tsconfig.json" }],
    language: "typescript",
    framework: "nodejs",
    skills: []
  },
  {
    indicators: [{ type: "file", pattern: "package.json" }],
    language: "javascript",
    framework: "nodejs",
    skills: []
  },
  {
    indicators: [{ type: "file", pattern: "go.mod" }],
    language: "go",
    skills: []
  },
  {
    indicators: [{ type: "file", pattern: "Cargo.toml" }],
    language: "rust",
    skills: []
  },
  {
    indicators: [
      { type: "file", pattern: "pyproject.toml" },
      { type: "file", pattern: "setup.py" },
      { type: "file", pattern: "requirements.txt" }
    ],
    language: "python",
    skills: []
  }
];
function matchesIndicator(dirEntries, indicator, directory) {
  switch (indicator.type) {
    case "file":
      return dirEntries.includes(indicator.pattern);
    case "extension":
      return dirEntries.some((entry) => entry.endsWith(indicator.pattern));
    case "directory": {
      const dirPath = (0, import_path.join)(directory, indicator.pattern);
      return (0, import_fs.existsSync)(dirPath) && (0, import_fs.statSync)(dirPath).isDirectory();
    }
  }
}
function detectProject(directory) {
  if (!(0, import_fs.existsSync)(directory)) {
    throw new Error(`Directory does not exist: ${directory}`);
  }
  if (!(0, import_fs.statSync)(directory).isDirectory()) {
    throw new Error(`Not a directory: ${directory}`);
  }
  const entries = (0, import_fs.readdirSync)(directory);
  const languages = /* @__PURE__ */ new Set();
  const frameworks = /* @__PURE__ */ new Set();
  const suggestedSkills = /* @__PURE__ */ new Set();
  const isGitRepo = (0, import_fs.existsSync)((0, import_path.join)(directory, ".git")) && (0, import_fs.statSync)((0, import_path.join)(directory, ".git")).isDirectory();
  if (isGitRepo) {
    suggestedSkills.add("managing-pull-requests");
  }
  for (const rule of DETECTION_RULES) {
    const matched = rule.indicators.some(
      (indicator) => matchesIndicator(entries, indicator, directory)
    );
    if (matched) {
      languages.add(rule.language);
      if (rule.framework) {
        frameworks.add(rule.framework);
      }
      for (const skill of rule.skills) {
        suggestedSkills.add(skill);
      }
    }
  }
  return {
    languages: Array.from(languages),
    frameworks: Array.from(frameworks),
    suggestedSkills: Array.from(suggestedSkills),
    isGitRepo
  };
}

// src/cli/skill-catalog.ts
var import_fs2 = require("fs");
var import_path3 = require("path");

// src/cli/config-paths.ts
var import_os = require("os");
var import_path2 = require("path");
function getUserConfigDir() {
  return (0, import_path2.join)((0, import_os.homedir)(), ".config", "opencode");
}
function getUserWeaveConfigPath() {
  return (0, import_path2.join)(getUserConfigDir(), "weave-opencode.jsonc");
}
function getSkillsDir() {
  return (0, import_path2.join)(getUserConfigDir(), "skills");
}
function getProjectConfigDir(projectDir) {
  return (0, import_path2.join)(projectDir, ".opencode");
}
function getProjectWeaveConfigPath(projectDir) {
  return (0, import_path2.join)(getProjectConfigDir(projectDir), "weave-opencode.jsonc");
}
function getTokenHashPath() {
  return (0, import_path2.join)((0, import_os.homedir)(), ".weave", "api-token.hash");
}

// src/cli/skill-catalog.ts
function parseFrontmatter(content) {
  const lines = content.split("\n");
  if (lines[0]?.trim() !== "---") {
    return null;
  }
  let name = "";
  let description = "";
  let foundEnd = false;
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === "---") {
      foundEnd = true;
      break;
    }
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim();
    if (key === "name") {
      name = value;
    } else if (key === "description") {
      description = value;
    }
  }
  if (!foundEnd || !name) {
    return null;
  }
  return { name, description };
}
function parseJsonc(content) {
  let cleaned = "";
  let inString = false;
  let inSingleLineComment = false;
  let inMultiLineComment = false;
  let i = 0;
  while (i < content.length) {
    if (inSingleLineComment) {
      if (content[i] === "\n") {
        inSingleLineComment = false;
        cleaned += "\n";
      }
      i++;
      continue;
    }
    if (inMultiLineComment) {
      if (content[i] === "*" && content[i + 1] === "/") {
        inMultiLineComment = false;
        i += 2;
        continue;
      }
      if (content[i] === "\n") {
        cleaned += "\n";
      }
      i++;
      continue;
    }
    if (inString) {
      if (content[i] === "\\" && i + 1 < content.length) {
        cleaned += content[i] + content[i + 1];
        i += 2;
        continue;
      }
      if (content[i] === '"') {
        inString = false;
      }
      cleaned += content[i];
      i++;
      continue;
    }
    if (content[i] === '"') {
      inString = true;
      cleaned += content[i];
      i++;
      continue;
    }
    if (content[i] === "/" && content[i + 1] === "/") {
      inSingleLineComment = true;
      i += 2;
      continue;
    }
    if (content[i] === "/" && content[i + 1] === "*") {
      inMultiLineComment = true;
      i += 2;
      continue;
    }
    cleaned += content[i];
    i++;
  }
  cleaned = cleaned.replace(/,\s*([\]}])/g, "$1");
  return JSON.parse(cleaned);
}
function readWeaveConfig(configPath) {
  if (!(0, import_fs2.existsSync)(configPath)) {
    return null;
  }
  try {
    const content = (0, import_fs2.readFileSync)(configPath, "utf-8");
    return parseJsonc(content);
  } catch {
    return null;
  }
}
function getAgentAssignments(config, skillName) {
  if (!config?.agents) return [];
  const agents = [];
  for (const [agentName, agentConfig] of Object.entries(config.agents)) {
    if (agentConfig.skills?.includes(skillName)) {
      agents.push(agentName);
    }
  }
  return agents;
}
function listInstalledSkills(skillsDir, configPath) {
  const dir = skillsDir ?? getSkillsDir();
  const cfgPath = configPath ?? getUserWeaveConfigPath();
  if (!(0, import_fs2.existsSync)(dir)) {
    return [];
  }
  const config = readWeaveConfig(cfgPath);
  const skills = [];
  const entries = (0, import_fs2.readdirSync)(dir);
  for (const entry of entries) {
    const skillDir = (0, import_path3.join)(dir, entry);
    if (!(0, import_fs2.statSync)(skillDir).isDirectory()) continue;
    const skillFile = (0, import_path3.join)(skillDir, "SKILL.md");
    if (!(0, import_fs2.existsSync)(skillFile)) continue;
    const content = (0, import_fs2.readFileSync)(skillFile, "utf-8");
    const frontmatter = parseFrontmatter(content);
    if (!frontmatter) continue;
    skills.push({
      name: frontmatter.name,
      description: frontmatter.description,
      path: skillDir,
      assignedAgents: getAgentAssignments(config, frontmatter.name)
    });
  }
  return skills.sort((a, b) => a.name.localeCompare(b.name));
}

// src/cli/init.ts
var AGENT_SKILL_MAP = {
  tapestry: [
    "enforcing-csharp-standards",
    "enforcing-dotnet-testing",
    "verifying-release-builds"
  ],
  shuttle: ["enforcing-csharp-standards", "enforcing-dotnet-testing"],
  weft: ["reviewing-csharp-code"]
};
function generateConfig(enabledSkills, agentSkillMap) {
  const agents = {};
  for (const [agent, candidateSkills] of Object.entries(agentSkillMap)) {
    const skills = candidateSkills.filter((s) => enabledSkills.includes(s));
    if (skills.length > 0) {
      agents[agent] = { skills };
    }
  }
  const config = { agents };
  const json = JSON.stringify(config, null, 2);
  return `// Generated by weave-fleet init \u2014 customize as needed.
// This is deep-merged with ~/.config/opencode/weave-opencode.jsonc
${json}
`;
}
function runInit(directory, options = {}) {
  const { force = false, dryRun = false } = options;
  const projectDir = (0, import_path4.resolve)(directory);
  if (!(0, import_fs3.existsSync)(projectDir)) {
    throw new Error(`Directory does not exist: ${projectDir}`);
  }
  const configPath = getProjectWeaveConfigPath(projectDir);
  if ((0, import_fs3.existsSync)(configPath) && !force) {
    throw new Error(
      `Config already exists at ${configPath}. Use --force to overwrite.`
    );
  }
  const profile = detectProject(projectDir);
  const installed = listInstalledSkills();
  const installedNames = new Set(installed.map((s) => s.name));
  const enabledSkills = profile.suggestedSkills.filter(
    (s) => installedNames.has(s)
  );
  const configContent = generateConfig(enabledSkills, AGENT_SKILL_MAP);
  if (!dryRun) {
    const configDir = getProjectConfigDir(projectDir);
    (0, import_fs3.mkdirSync)(configDir, { recursive: true });
    (0, import_fs3.writeFileSync)(configPath, configContent, "utf-8");
  }
  return {
    configPath,
    profile,
    enabledSkills,
    written: !dryRun
  };
}

// src/cli/skill-installer.ts
var import_fs4 = require("fs");
var import_path5 = require("path");
function resolveSource(source) {
  if (source.startsWith("github:")) {
    const path = source.slice("github:".length);
    return {
      type: "url",
      resolved: `https://raw.githubusercontent.com/${path.replace(/^\//, "")}/HEAD/SKILL.md`
    };
  }
  if (source.startsWith("http://") || source.startsWith("https://")) {
    return { type: "url", resolved: source };
  }
  return { type: "local", resolved: source };
}
async function fetchContent(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `Failed to fetch ${url}: ${response.status} ${response.statusText}`
    );
  }
  return response.text();
}
async function installSkill(source, options = {}) {
  const { force = false, agents, skillsDir, configPath } = options;
  const dir = skillsDir ?? getSkillsDir();
  const cfgPath = configPath ?? getUserWeaveConfigPath();
  const resolved = resolveSource(source);
  let content;
  if (resolved.type === "url") {
    content = await fetchContent(resolved.resolved);
  } else {
    if (!(0, import_fs4.existsSync)(resolved.resolved)) {
      throw new Error(`File not found: ${resolved.resolved}`);
    }
    content = (0, import_fs4.readFileSync)(resolved.resolved, "utf-8");
  }
  const frontmatter = parseFrontmatter(content);
  if (!frontmatter) {
    throw new Error(
      "Invalid SKILL.md: missing or invalid YAML frontmatter. Expected --- fences with at least a 'name' field."
    );
  }
  if (!frontmatter.name) {
    throw new Error("Invalid SKILL.md: 'name' field is required in frontmatter.");
  }
  const skillDir = (0, import_path5.join)(dir, frontmatter.name);
  if ((0, import_fs4.existsSync)(skillDir) && !force) {
    throw new Error(
      `Skill '${frontmatter.name}' is already installed at ${skillDir}. Use --force to overwrite.`
    );
  }
  (0, import_fs4.mkdirSync)(skillDir, { recursive: true });
  (0, import_fs4.writeFileSync)((0, import_path5.join)(skillDir, "SKILL.md"), content, "utf-8");
  if (agents && agents.length > 0) {
    addSkillToAgents(frontmatter.name, agents, cfgPath);
  }
  return {
    name: frontmatter.name,
    description: frontmatter.description,
    path: skillDir,
    source
  };
}
function removeSkill(name, options = {}) {
  const { skillsDir, configPath } = options;
  const dir = skillsDir ?? getSkillsDir();
  const cfgPath = configPath ?? getUserWeaveConfigPath();
  const skillDir = (0, import_path5.join)(dir, name);
  if (!(0, import_fs4.existsSync)(skillDir)) {
    throw new Error(`Skill '${name}' is not installed.`);
  }
  (0, import_fs4.rmSync)(skillDir, { recursive: true, force: true });
  removeSkillFromAgents(name, cfgPath);
}
function addSkillToAgents(skillName, agents, configPath) {
  const config = readWeaveConfig(configPath) ?? {};
  if (!config.agents) {
    config.agents = {};
  }
  for (const agent of agents) {
    if (!config.agents[agent]) {
      config.agents[agent] = { skills: [] };
    }
    if (!config.agents[agent].skills) {
      config.agents[agent].skills = [];
    }
    if (!config.agents[agent].skills.includes(skillName)) {
      config.agents[agent].skills.push(skillName);
    }
  }
  writeConfigFile(configPath, config);
}
function removeSkillFromAgents(skillName, configPath) {
  const config = readWeaveConfig(configPath);
  if (!config?.agents) return;
  let changed = false;
  for (const [, agentConfig] of Object.entries(config.agents)) {
    if (agentConfig.skills) {
      const idx = agentConfig.skills.indexOf(skillName);
      if (idx !== -1) {
        agentConfig.skills.splice(idx, 1);
        changed = true;
      }
    }
  }
  if (changed) {
    writeConfigFile(configPath, config);
  }
}
function writeConfigFile(configPath, config) {
  const dir = (0, import_path5.dirname)(configPath);
  (0, import_fs4.mkdirSync)(dir, { recursive: true });
  const content = JSON.stringify(config, null, 2);
  (0, import_fs4.writeFileSync)(configPath, content, "utf-8");
}

// src/cli/skill.ts
function runSkillList() {
  const skills = listInstalledSkills();
  if (skills.length === 0) {
    console.log("No skills installed.");
    console.log(
      "Install skills with: weave-fleet skill install <url-or-path>"
    );
    return;
  }
  console.log(`
Installed Skills (${skills.length}):
`);
  const maxNameLen = Math.max(...skills.map((s) => s.name.length));
  for (const skill of skills) {
    const agents = skill.assignedAgents.length > 0 ? ` -> ${skill.assignedAgents.join(", ")}` : "";
    const name = skill.name.padEnd(maxNameLen + 2);
    console.log(`  ${name}${skill.description}${agents}`);
  }
  console.log();
}
async function runSkillInstall(source, options = {}) {
  try {
    const result = await installSkill(source, options);
    console.log(`
Installed skill: ${result.name}`);
    console.log(`  Description: ${result.description}`);
    console.log(`  Path: ${result.path}`);
    if (options.agents && options.agents.length > 0) {
      console.log(`  Assigned to agents: ${options.agents.join(", ")}`);
    }
    console.log();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Error: ${message}`);
    process.exit(1);
  }
}
function runSkillRemove(name) {
  try {
    removeSkill(name);
    console.log(`Removed skill: ${name}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Error: ${message}`);
    process.exit(1);
  }
}

// src/cli/serve.ts
var import_child_process = require("child_process");
var import_fs6 = require("fs");
var import_path7 = require("path");

// src/lib/server/token-manager.ts
var import_crypto2 = require("crypto");
var import_fs5 = require("fs");
var import_path6 = require("path");

// node_modules/bcryptjs/index.js
var import_crypto = __toESM(require("crypto"), 1);
var randomFallback = null;
function randomBytes(len) {
  try {
    return crypto.getRandomValues(new Uint8Array(len));
  } catch {
  }
  try {
    return import_crypto.default.randomBytes(len);
  } catch {
  }
  if (!randomFallback) {
    throw Error(
      "Neither WebCryptoAPI nor a crypto module is available. Use bcrypt.setRandomFallback to set an alternative"
    );
  }
  return randomFallback(len);
}
function genSaltSync(rounds, seed_length) {
  rounds = rounds || GENSALT_DEFAULT_LOG2_ROUNDS;
  if (typeof rounds !== "number")
    throw Error(
      "Illegal arguments: " + typeof rounds + ", " + typeof seed_length
    );
  if (rounds < 4) rounds = 4;
  else if (rounds > 31) rounds = 31;
  var salt = [];
  salt.push("$2b$");
  if (rounds < 10) salt.push("0");
  salt.push(rounds.toString());
  salt.push("$");
  salt.push(base64_encode(randomBytes(BCRYPT_SALT_LEN), BCRYPT_SALT_LEN));
  return salt.join("");
}
function genSalt(rounds, seed_length, callback) {
  if (typeof seed_length === "function")
    callback = seed_length, seed_length = void 0;
  if (typeof rounds === "function") callback = rounds, rounds = void 0;
  if (typeof rounds === "undefined") rounds = GENSALT_DEFAULT_LOG2_ROUNDS;
  else if (typeof rounds !== "number")
    throw Error("illegal arguments: " + typeof rounds);
  function _async(callback2) {
    nextTick(function() {
      try {
        callback2(null, genSaltSync(rounds));
      } catch (err) {
        callback2(err);
      }
    });
  }
  if (callback) {
    if (typeof callback !== "function")
      throw Error("Illegal callback: " + typeof callback);
    _async(callback);
  } else
    return new Promise(function(resolve2, reject) {
      _async(function(err, res) {
        if (err) {
          reject(err);
          return;
        }
        resolve2(res);
      });
    });
}
function hash(password, salt, callback, progressCallback) {
  function _async(callback2) {
    if (typeof password === "string" && typeof salt === "number")
      genSalt(salt, function(err, salt2) {
        _hash(password, salt2, callback2, progressCallback);
      });
    else if (typeof password === "string" && typeof salt === "string")
      _hash(password, salt, callback2, progressCallback);
    else
      nextTick(
        callback2.bind(
          this,
          Error("Illegal arguments: " + typeof password + ", " + typeof salt)
        )
      );
  }
  if (callback) {
    if (typeof callback !== "function")
      throw Error("Illegal callback: " + typeof callback);
    _async(callback);
  } else
    return new Promise(function(resolve2, reject) {
      _async(function(err, res) {
        if (err) {
          reject(err);
          return;
        }
        resolve2(res);
      });
    });
}
var nextTick = typeof setImmediate === "function" ? setImmediate : typeof scheduler === "object" && typeof scheduler.postTask === "function" ? scheduler.postTask.bind(scheduler) : setTimeout;
function utf8Length(string) {
  var len = 0, c = 0;
  for (var i = 0; i < string.length; ++i) {
    c = string.charCodeAt(i);
    if (c < 128) len += 1;
    else if (c < 2048) len += 2;
    else if ((c & 64512) === 55296 && (string.charCodeAt(i + 1) & 64512) === 56320) {
      ++i;
      len += 4;
    } else len += 3;
  }
  return len;
}
function utf8Array(string) {
  var offset = 0, c1, c2;
  var buffer = new Array(utf8Length(string));
  for (var i = 0, k = string.length; i < k; ++i) {
    c1 = string.charCodeAt(i);
    if (c1 < 128) {
      buffer[offset++] = c1;
    } else if (c1 < 2048) {
      buffer[offset++] = c1 >> 6 | 192;
      buffer[offset++] = c1 & 63 | 128;
    } else if ((c1 & 64512) === 55296 && ((c2 = string.charCodeAt(i + 1)) & 64512) === 56320) {
      c1 = 65536 + ((c1 & 1023) << 10) + (c2 & 1023);
      ++i;
      buffer[offset++] = c1 >> 18 | 240;
      buffer[offset++] = c1 >> 12 & 63 | 128;
      buffer[offset++] = c1 >> 6 & 63 | 128;
      buffer[offset++] = c1 & 63 | 128;
    } else {
      buffer[offset++] = c1 >> 12 | 224;
      buffer[offset++] = c1 >> 6 & 63 | 128;
      buffer[offset++] = c1 & 63 | 128;
    }
  }
  return buffer;
}
var BASE64_CODE = "./ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789".split("");
var BASE64_INDEX = [
  -1,
  -1,
  -1,
  -1,
  -1,
  -1,
  -1,
  -1,
  -1,
  -1,
  -1,
  -1,
  -1,
  -1,
  -1,
  -1,
  -1,
  -1,
  -1,
  -1,
  -1,
  -1,
  -1,
  -1,
  -1,
  -1,
  -1,
  -1,
  -1,
  -1,
  -1,
  -1,
  -1,
  -1,
  -1,
  -1,
  -1,
  -1,
  -1,
  -1,
  -1,
  -1,
  -1,
  -1,
  -1,
  -1,
  0,
  1,
  54,
  55,
  56,
  57,
  58,
  59,
  60,
  61,
  62,
  63,
  -1,
  -1,
  -1,
  -1,
  -1,
  -1,
  -1,
  2,
  3,
  4,
  5,
  6,
  7,
  8,
  9,
  10,
  11,
  12,
  13,
  14,
  15,
  16,
  17,
  18,
  19,
  20,
  21,
  22,
  23,
  24,
  25,
  26,
  27,
  -1,
  -1,
  -1,
  -1,
  -1,
  -1,
  28,
  29,
  30,
  31,
  32,
  33,
  34,
  35,
  36,
  37,
  38,
  39,
  40,
  41,
  42,
  43,
  44,
  45,
  46,
  47,
  48,
  49,
  50,
  51,
  52,
  53,
  -1,
  -1,
  -1,
  -1,
  -1
];
function base64_encode(b, len) {
  var off = 0, rs = [], c1, c2;
  if (len <= 0 || len > b.length) throw Error("Illegal len: " + len);
  while (off < len) {
    c1 = b[off++] & 255;
    rs.push(BASE64_CODE[c1 >> 2 & 63]);
    c1 = (c1 & 3) << 4;
    if (off >= len) {
      rs.push(BASE64_CODE[c1 & 63]);
      break;
    }
    c2 = b[off++] & 255;
    c1 |= c2 >> 4 & 15;
    rs.push(BASE64_CODE[c1 & 63]);
    c1 = (c2 & 15) << 2;
    if (off >= len) {
      rs.push(BASE64_CODE[c1 & 63]);
      break;
    }
    c2 = b[off++] & 255;
    c1 |= c2 >> 6 & 3;
    rs.push(BASE64_CODE[c1 & 63]);
    rs.push(BASE64_CODE[c2 & 63]);
  }
  return rs.join("");
}
function base64_decode(s, len) {
  var off = 0, slen = s.length, olen = 0, rs = [], c1, c2, c3, c4, o, code;
  if (len <= 0) throw Error("Illegal len: " + len);
  while (off < slen - 1 && olen < len) {
    code = s.charCodeAt(off++);
    c1 = code < BASE64_INDEX.length ? BASE64_INDEX[code] : -1;
    code = s.charCodeAt(off++);
    c2 = code < BASE64_INDEX.length ? BASE64_INDEX[code] : -1;
    if (c1 == -1 || c2 == -1) break;
    o = c1 << 2 >>> 0;
    o |= (c2 & 48) >> 4;
    rs.push(String.fromCharCode(o));
    if (++olen >= len || off >= slen) break;
    code = s.charCodeAt(off++);
    c3 = code < BASE64_INDEX.length ? BASE64_INDEX[code] : -1;
    if (c3 == -1) break;
    o = (c2 & 15) << 4 >>> 0;
    o |= (c3 & 60) >> 2;
    rs.push(String.fromCharCode(o));
    if (++olen >= len || off >= slen) break;
    code = s.charCodeAt(off++);
    c4 = code < BASE64_INDEX.length ? BASE64_INDEX[code] : -1;
    o = (c3 & 3) << 6 >>> 0;
    o |= c4;
    rs.push(String.fromCharCode(o));
    ++olen;
  }
  var res = [];
  for (off = 0; off < olen; off++) res.push(rs[off].charCodeAt(0));
  return res;
}
var BCRYPT_SALT_LEN = 16;
var GENSALT_DEFAULT_LOG2_ROUNDS = 10;
var BLOWFISH_NUM_ROUNDS = 16;
var MAX_EXECUTION_TIME = 100;
var P_ORIG = [
  608135816,
  2242054355,
  320440878,
  57701188,
  2752067618,
  698298832,
  137296536,
  3964562569,
  1160258022,
  953160567,
  3193202383,
  887688300,
  3232508343,
  3380367581,
  1065670069,
  3041331479,
  2450970073,
  2306472731
];
var S_ORIG = [
  3509652390,
  2564797868,
  805139163,
  3491422135,
  3101798381,
  1780907670,
  3128725573,
  4046225305,
  614570311,
  3012652279,
  134345442,
  2240740374,
  1667834072,
  1901547113,
  2757295779,
  4103290238,
  227898511,
  1921955416,
  1904987480,
  2182433518,
  2069144605,
  3260701109,
  2620446009,
  720527379,
  3318853667,
  677414384,
  3393288472,
  3101374703,
  2390351024,
  1614419982,
  1822297739,
  2954791486,
  3608508353,
  3174124327,
  2024746970,
  1432378464,
  3864339955,
  2857741204,
  1464375394,
  1676153920,
  1439316330,
  715854006,
  3033291828,
  289532110,
  2706671279,
  2087905683,
  3018724369,
  1668267050,
  732546397,
  1947742710,
  3462151702,
  2609353502,
  2950085171,
  1814351708,
  2050118529,
  680887927,
  999245976,
  1800124847,
  3300911131,
  1713906067,
  1641548236,
  4213287313,
  1216130144,
  1575780402,
  4018429277,
  3917837745,
  3693486850,
  3949271944,
  596196993,
  3549867205,
  258830323,
  2213823033,
  772490370,
  2760122372,
  1774776394,
  2652871518,
  566650946,
  4142492826,
  1728879713,
  2882767088,
  1783734482,
  3629395816,
  2517608232,
  2874225571,
  1861159788,
  326777828,
  3124490320,
  2130389656,
  2716951837,
  967770486,
  1724537150,
  2185432712,
  2364442137,
  1164943284,
  2105845187,
  998989502,
  3765401048,
  2244026483,
  1075463327,
  1455516326,
  1322494562,
  910128902,
  469688178,
  1117454909,
  936433444,
  3490320968,
  3675253459,
  1240580251,
  122909385,
  2157517691,
  634681816,
  4142456567,
  3825094682,
  3061402683,
  2540495037,
  79693498,
  3249098678,
  1084186820,
  1583128258,
  426386531,
  1761308591,
  1047286709,
  322548459,
  995290223,
  1845252383,
  2603652396,
  3431023940,
  2942221577,
  3202600964,
  3727903485,
  1712269319,
  422464435,
  3234572375,
  1170764815,
  3523960633,
  3117677531,
  1434042557,
  442511882,
  3600875718,
  1076654713,
  1738483198,
  4213154764,
  2393238008,
  3677496056,
  1014306527,
  4251020053,
  793779912,
  2902807211,
  842905082,
  4246964064,
  1395751752,
  1040244610,
  2656851899,
  3396308128,
  445077038,
  3742853595,
  3577915638,
  679411651,
  2892444358,
  2354009459,
  1767581616,
  3150600392,
  3791627101,
  3102740896,
  284835224,
  4246832056,
  1258075500,
  768725851,
  2589189241,
  3069724005,
  3532540348,
  1274779536,
  3789419226,
  2764799539,
  1660621633,
  3471099624,
  4011903706,
  913787905,
  3497959166,
  737222580,
  2514213453,
  2928710040,
  3937242737,
  1804850592,
  3499020752,
  2949064160,
  2386320175,
  2390070455,
  2415321851,
  4061277028,
  2290661394,
  2416832540,
  1336762016,
  1754252060,
  3520065937,
  3014181293,
  791618072,
  3188594551,
  3933548030,
  2332172193,
  3852520463,
  3043980520,
  413987798,
  3465142937,
  3030929376,
  4245938359,
  2093235073,
  3534596313,
  375366246,
  2157278981,
  2479649556,
  555357303,
  3870105701,
  2008414854,
  3344188149,
  4221384143,
  3956125452,
  2067696032,
  3594591187,
  2921233993,
  2428461,
  544322398,
  577241275,
  1471733935,
  610547355,
  4027169054,
  1432588573,
  1507829418,
  2025931657,
  3646575487,
  545086370,
  48609733,
  2200306550,
  1653985193,
  298326376,
  1316178497,
  3007786442,
  2064951626,
  458293330,
  2589141269,
  3591329599,
  3164325604,
  727753846,
  2179363840,
  146436021,
  1461446943,
  4069977195,
  705550613,
  3059967265,
  3887724982,
  4281599278,
  3313849956,
  1404054877,
  2845806497,
  146425753,
  1854211946,
  1266315497,
  3048417604,
  3681880366,
  3289982499,
  290971e4,
  1235738493,
  2632868024,
  2414719590,
  3970600049,
  1771706367,
  1449415276,
  3266420449,
  422970021,
  1963543593,
  2690192192,
  3826793022,
  1062508698,
  1531092325,
  1804592342,
  2583117782,
  2714934279,
  4024971509,
  1294809318,
  4028980673,
  1289560198,
  2221992742,
  1669523910,
  35572830,
  157838143,
  1052438473,
  1016535060,
  1802137761,
  1753167236,
  1386275462,
  3080475397,
  2857371447,
  1040679964,
  2145300060,
  2390574316,
  1461121720,
  2956646967,
  4031777805,
  4028374788,
  33600511,
  2920084762,
  1018524850,
  629373528,
  3691585981,
  3515945977,
  2091462646,
  2486323059,
  586499841,
  988145025,
  935516892,
  3367335476,
  2599673255,
  2839830854,
  265290510,
  3972581182,
  2759138881,
  3795373465,
  1005194799,
  847297441,
  406762289,
  1314163512,
  1332590856,
  1866599683,
  4127851711,
  750260880,
  613907577,
  1450815602,
  3165620655,
  3734664991,
  3650291728,
  3012275730,
  3704569646,
  1427272223,
  778793252,
  1343938022,
  2676280711,
  2052605720,
  1946737175,
  3164576444,
  3914038668,
  3967478842,
  3682934266,
  1661551462,
  3294938066,
  4011595847,
  840292616,
  3712170807,
  616741398,
  312560963,
  711312465,
  1351876610,
  322626781,
  1910503582,
  271666773,
  2175563734,
  1594956187,
  70604529,
  3617834859,
  1007753275,
  1495573769,
  4069517037,
  2549218298,
  2663038764,
  504708206,
  2263041392,
  3941167025,
  2249088522,
  1514023603,
  1998579484,
  1312622330,
  694541497,
  2582060303,
  2151582166,
  1382467621,
  776784248,
  2618340202,
  3323268794,
  2497899128,
  2784771155,
  503983604,
  4076293799,
  907881277,
  423175695,
  432175456,
  1378068232,
  4145222326,
  3954048622,
  3938656102,
  3820766613,
  2793130115,
  2977904593,
  26017576,
  3274890735,
  3194772133,
  1700274565,
  1756076034,
  4006520079,
  3677328699,
  720338349,
  1533947780,
  354530856,
  688349552,
  3973924725,
  1637815568,
  332179504,
  3949051286,
  53804574,
  2852348879,
  3044236432,
  1282449977,
  3583942155,
  3416972820,
  4006381244,
  1617046695,
  2628476075,
  3002303598,
  1686838959,
  431878346,
  2686675385,
  1700445008,
  1080580658,
  1009431731,
  832498133,
  3223435511,
  2605976345,
  2271191193,
  2516031870,
  1648197032,
  4164389018,
  2548247927,
  300782431,
  375919233,
  238389289,
  3353747414,
  2531188641,
  2019080857,
  1475708069,
  455242339,
  2609103871,
  448939670,
  3451063019,
  1395535956,
  2413381860,
  1841049896,
  1491858159,
  885456874,
  4264095073,
  4001119347,
  1565136089,
  3898914787,
  1108368660,
  540939232,
  1173283510,
  2745871338,
  3681308437,
  4207628240,
  3343053890,
  4016749493,
  1699691293,
  1103962373,
  3625875870,
  2256883143,
  3830138730,
  1031889488,
  3479347698,
  1535977030,
  4236805024,
  3251091107,
  2132092099,
  1774941330,
  1199868427,
  1452454533,
  157007616,
  2904115357,
  342012276,
  595725824,
  1480756522,
  206960106,
  497939518,
  591360097,
  863170706,
  2375253569,
  3596610801,
  1814182875,
  2094937945,
  3421402208,
  1082520231,
  3463918190,
  2785509508,
  435703966,
  3908032597,
  1641649973,
  2842273706,
  3305899714,
  1510255612,
  2148256476,
  2655287854,
  3276092548,
  4258621189,
  236887753,
  3681803219,
  274041037,
  1734335097,
  3815195456,
  3317970021,
  1899903192,
  1026095262,
  4050517792,
  356393447,
  2410691914,
  3873677099,
  3682840055,
  3913112168,
  2491498743,
  4132185628,
  2489919796,
  1091903735,
  1979897079,
  3170134830,
  3567386728,
  3557303409,
  857797738,
  1136121015,
  1342202287,
  507115054,
  2535736646,
  337727348,
  3213592640,
  1301675037,
  2528481711,
  1895095763,
  1721773893,
  3216771564,
  62756741,
  2142006736,
  835421444,
  2531993523,
  1442658625,
  3659876326,
  2882144922,
  676362277,
  1392781812,
  170690266,
  3921047035,
  1759253602,
  3611846912,
  1745797284,
  664899054,
  1329594018,
  3901205900,
  3045908486,
  2062866102,
  2865634940,
  3543621612,
  3464012697,
  1080764994,
  553557557,
  3656615353,
  3996768171,
  991055499,
  499776247,
  1265440854,
  648242737,
  3940784050,
  980351604,
  3713745714,
  1749149687,
  3396870395,
  4211799374,
  3640570775,
  1161844396,
  3125318951,
  1431517754,
  545492359,
  4268468663,
  3499529547,
  1437099964,
  2702547544,
  3433638243,
  2581715763,
  2787789398,
  1060185593,
  1593081372,
  2418618748,
  4260947970,
  69676912,
  2159744348,
  86519011,
  2512459080,
  3838209314,
  1220612927,
  3339683548,
  133810670,
  1090789135,
  1078426020,
  1569222167,
  845107691,
  3583754449,
  4072456591,
  1091646820,
  628848692,
  1613405280,
  3757631651,
  526609435,
  236106946,
  48312990,
  2942717905,
  3402727701,
  1797494240,
  859738849,
  992217954,
  4005476642,
  2243076622,
  3870952857,
  3732016268,
  765654824,
  3490871365,
  2511836413,
  1685915746,
  3888969200,
  1414112111,
  2273134842,
  3281911079,
  4080962846,
  172450625,
  2569994100,
  980381355,
  4109958455,
  2819808352,
  2716589560,
  2568741196,
  3681446669,
  3329971472,
  1835478071,
  660984891,
  3704678404,
  4045999559,
  3422617507,
  3040415634,
  1762651403,
  1719377915,
  3470491036,
  2693910283,
  3642056355,
  3138596744,
  1364962596,
  2073328063,
  1983633131,
  926494387,
  3423689081,
  2150032023,
  4096667949,
  1749200295,
  3328846651,
  309677260,
  2016342300,
  1779581495,
  3079819751,
  111262694,
  1274766160,
  443224088,
  298511866,
  1025883608,
  3806446537,
  1145181785,
  168956806,
  3641502830,
  3584813610,
  1689216846,
  3666258015,
  3200248200,
  1692713982,
  2646376535,
  4042768518,
  1618508792,
  1610833997,
  3523052358,
  4130873264,
  2001055236,
  3610705100,
  2202168115,
  4028541809,
  2961195399,
  1006657119,
  2006996926,
  3186142756,
  1430667929,
  3210227297,
  1314452623,
  4074634658,
  4101304120,
  2273951170,
  1399257539,
  3367210612,
  3027628629,
  1190975929,
  2062231137,
  2333990788,
  2221543033,
  2438960610,
  1181637006,
  548689776,
  2362791313,
  3372408396,
  3104550113,
  3145860560,
  296247880,
  1970579870,
  3078560182,
  3769228297,
  1714227617,
  3291629107,
  3898220290,
  166772364,
  1251581989,
  493813264,
  448347421,
  195405023,
  2709975567,
  677966185,
  3703036547,
  1463355134,
  2715995803,
  1338867538,
  1343315457,
  2802222074,
  2684532164,
  233230375,
  2599980071,
  2000651841,
  3277868038,
  1638401717,
  4028070440,
  3237316320,
  6314154,
  819756386,
  300326615,
  590932579,
  1405279636,
  3267499572,
  3150704214,
  2428286686,
  3959192993,
  3461946742,
  1862657033,
  1266418056,
  963775037,
  2089974820,
  2263052895,
  1917689273,
  448879540,
  3550394620,
  3981727096,
  150775221,
  3627908307,
  1303187396,
  508620638,
  2975983352,
  2726630617,
  1817252668,
  1876281319,
  1457606340,
  908771278,
  3720792119,
  3617206836,
  2455994898,
  1729034894,
  1080033504,
  976866871,
  3556439503,
  2881648439,
  1522871579,
  1555064734,
  1336096578,
  3548522304,
  2579274686,
  3574697629,
  3205460757,
  3593280638,
  3338716283,
  3079412587,
  564236357,
  2993598910,
  1781952180,
  1464380207,
  3163844217,
  3332601554,
  1699332808,
  1393555694,
  1183702653,
  3581086237,
  1288719814,
  691649499,
  2847557200,
  2895455976,
  3193889540,
  2717570544,
  1781354906,
  1676643554,
  2592534050,
  3230253752,
  1126444790,
  2770207658,
  2633158820,
  2210423226,
  2615765581,
  2414155088,
  3127139286,
  673620729,
  2805611233,
  1269405062,
  4015350505,
  3341807571,
  4149409754,
  1057255273,
  2012875353,
  2162469141,
  2276492801,
  2601117357,
  993977747,
  3918593370,
  2654263191,
  753973209,
  36408145,
  2530585658,
  25011837,
  3520020182,
  2088578344,
  530523599,
  2918365339,
  1524020338,
  1518925132,
  3760827505,
  3759777254,
  1202760957,
  3985898139,
  3906192525,
  674977740,
  4174734889,
  2031300136,
  2019492241,
  3983892565,
  4153806404,
  3822280332,
  352677332,
  2297720250,
  60907813,
  90501309,
  3286998549,
  1016092578,
  2535922412,
  2839152426,
  457141659,
  509813237,
  4120667899,
  652014361,
  1966332200,
  2975202805,
  55981186,
  2327461051,
  676427537,
  3255491064,
  2882294119,
  3433927263,
  1307055953,
  942726286,
  933058658,
  2468411793,
  3933900994,
  4215176142,
  1361170020,
  2001714738,
  2830558078,
  3274259782,
  1222529897,
  1679025792,
  2729314320,
  3714953764,
  1770335741,
  151462246,
  3013232138,
  1682292957,
  1483529935,
  471910574,
  1539241949,
  458788160,
  3436315007,
  1807016891,
  3718408830,
  978976581,
  1043663428,
  3165965781,
  1927990952,
  4200891579,
  2372276910,
  3208408903,
  3533431907,
  1412390302,
  2931980059,
  4132332400,
  1947078029,
  3881505623,
  4168226417,
  2941484381,
  1077988104,
  1320477388,
  886195818,
  18198404,
  3786409e3,
  2509781533,
  112762804,
  3463356488,
  1866414978,
  891333506,
  18488651,
  661792760,
  1628790961,
  3885187036,
  3141171499,
  876946877,
  2693282273,
  1372485963,
  791857591,
  2686433993,
  3759982718,
  3167212022,
  3472953795,
  2716379847,
  445679433,
  3561995674,
  3504004811,
  3574258232,
  54117162,
  3331405415,
  2381918588,
  3769707343,
  4154350007,
  1140177722,
  4074052095,
  668550556,
  3214352940,
  367459370,
  261225585,
  2610173221,
  4209349473,
  3468074219,
  3265815641,
  314222801,
  3066103646,
  3808782860,
  282218597,
  3406013506,
  3773591054,
  379116347,
  1285071038,
  846784868,
  2669647154,
  3771962079,
  3550491691,
  2305946142,
  453669953,
  1268987020,
  3317592352,
  3279303384,
  3744833421,
  2610507566,
  3859509063,
  266596637,
  3847019092,
  517658769,
  3462560207,
  3443424879,
  370717030,
  4247526661,
  2224018117,
  4143653529,
  4112773975,
  2788324899,
  2477274417,
  1456262402,
  2901442914,
  1517677493,
  1846949527,
  2295493580,
  3734397586,
  2176403920,
  1280348187,
  1908823572,
  3871786941,
  846861322,
  1172426758,
  3287448474,
  3383383037,
  1655181056,
  3139813346,
  901632758,
  1897031941,
  2986607138,
  3066810236,
  3447102507,
  1393639104,
  373351379,
  950779232,
  625454576,
  3124240540,
  4148612726,
  2007998917,
  544563296,
  2244738638,
  2330496472,
  2058025392,
  1291430526,
  424198748,
  50039436,
  29584100,
  3605783033,
  2429876329,
  2791104160,
  1057563949,
  3255363231,
  3075367218,
  3463963227,
  1469046755,
  985887462
];
var C_ORIG = [
  1332899944,
  1700884034,
  1701343084,
  1684370003,
  1668446532,
  1869963892
];
function _encipher(lr, off, P, S) {
  var n, l = lr[off], r = lr[off + 1];
  l ^= P[0];
  n = S[l >>> 24];
  n += S[256 | l >> 16 & 255];
  n ^= S[512 | l >> 8 & 255];
  n += S[768 | l & 255];
  r ^= n ^ P[1];
  n = S[r >>> 24];
  n += S[256 | r >> 16 & 255];
  n ^= S[512 | r >> 8 & 255];
  n += S[768 | r & 255];
  l ^= n ^ P[2];
  n = S[l >>> 24];
  n += S[256 | l >> 16 & 255];
  n ^= S[512 | l >> 8 & 255];
  n += S[768 | l & 255];
  r ^= n ^ P[3];
  n = S[r >>> 24];
  n += S[256 | r >> 16 & 255];
  n ^= S[512 | r >> 8 & 255];
  n += S[768 | r & 255];
  l ^= n ^ P[4];
  n = S[l >>> 24];
  n += S[256 | l >> 16 & 255];
  n ^= S[512 | l >> 8 & 255];
  n += S[768 | l & 255];
  r ^= n ^ P[5];
  n = S[r >>> 24];
  n += S[256 | r >> 16 & 255];
  n ^= S[512 | r >> 8 & 255];
  n += S[768 | r & 255];
  l ^= n ^ P[6];
  n = S[l >>> 24];
  n += S[256 | l >> 16 & 255];
  n ^= S[512 | l >> 8 & 255];
  n += S[768 | l & 255];
  r ^= n ^ P[7];
  n = S[r >>> 24];
  n += S[256 | r >> 16 & 255];
  n ^= S[512 | r >> 8 & 255];
  n += S[768 | r & 255];
  l ^= n ^ P[8];
  n = S[l >>> 24];
  n += S[256 | l >> 16 & 255];
  n ^= S[512 | l >> 8 & 255];
  n += S[768 | l & 255];
  r ^= n ^ P[9];
  n = S[r >>> 24];
  n += S[256 | r >> 16 & 255];
  n ^= S[512 | r >> 8 & 255];
  n += S[768 | r & 255];
  l ^= n ^ P[10];
  n = S[l >>> 24];
  n += S[256 | l >> 16 & 255];
  n ^= S[512 | l >> 8 & 255];
  n += S[768 | l & 255];
  r ^= n ^ P[11];
  n = S[r >>> 24];
  n += S[256 | r >> 16 & 255];
  n ^= S[512 | r >> 8 & 255];
  n += S[768 | r & 255];
  l ^= n ^ P[12];
  n = S[l >>> 24];
  n += S[256 | l >> 16 & 255];
  n ^= S[512 | l >> 8 & 255];
  n += S[768 | l & 255];
  r ^= n ^ P[13];
  n = S[r >>> 24];
  n += S[256 | r >> 16 & 255];
  n ^= S[512 | r >> 8 & 255];
  n += S[768 | r & 255];
  l ^= n ^ P[14];
  n = S[l >>> 24];
  n += S[256 | l >> 16 & 255];
  n ^= S[512 | l >> 8 & 255];
  n += S[768 | l & 255];
  r ^= n ^ P[15];
  n = S[r >>> 24];
  n += S[256 | r >> 16 & 255];
  n ^= S[512 | r >> 8 & 255];
  n += S[768 | r & 255];
  l ^= n ^ P[16];
  lr[off] = r ^ P[BLOWFISH_NUM_ROUNDS + 1];
  lr[off + 1] = l;
  return lr;
}
function _streamtoword(data, offp) {
  for (var i = 0, word = 0; i < 4; ++i)
    word = word << 8 | data[offp] & 255, offp = (offp + 1) % data.length;
  return { key: word, offp };
}
function _key(key, P, S) {
  var offset = 0, lr = [0, 0], plen = P.length, slen = S.length, sw;
  for (var i = 0; i < plen; i++)
    sw = _streamtoword(key, offset), offset = sw.offp, P[i] = P[i] ^ sw.key;
  for (i = 0; i < plen; i += 2)
    lr = _encipher(lr, 0, P, S), P[i] = lr[0], P[i + 1] = lr[1];
  for (i = 0; i < slen; i += 2)
    lr = _encipher(lr, 0, P, S), S[i] = lr[0], S[i + 1] = lr[1];
}
function _ekskey(data, key, P, S) {
  var offp = 0, lr = [0, 0], plen = P.length, slen = S.length, sw;
  for (var i = 0; i < plen; i++)
    sw = _streamtoword(key, offp), offp = sw.offp, P[i] = P[i] ^ sw.key;
  offp = 0;
  for (i = 0; i < plen; i += 2)
    sw = _streamtoword(data, offp), offp = sw.offp, lr[0] ^= sw.key, sw = _streamtoword(data, offp), offp = sw.offp, lr[1] ^= sw.key, lr = _encipher(lr, 0, P, S), P[i] = lr[0], P[i + 1] = lr[1];
  for (i = 0; i < slen; i += 2)
    sw = _streamtoword(data, offp), offp = sw.offp, lr[0] ^= sw.key, sw = _streamtoword(data, offp), offp = sw.offp, lr[1] ^= sw.key, lr = _encipher(lr, 0, P, S), S[i] = lr[0], S[i + 1] = lr[1];
}
function _crypt(b, salt, rounds, callback, progressCallback) {
  var cdata = C_ORIG.slice(), clen = cdata.length, err;
  if (rounds < 4 || rounds > 31) {
    err = Error("Illegal number of rounds (4-31): " + rounds);
    if (callback) {
      nextTick(callback.bind(this, err));
      return;
    } else throw err;
  }
  if (salt.length !== BCRYPT_SALT_LEN) {
    err = Error(
      "Illegal salt length: " + salt.length + " != " + BCRYPT_SALT_LEN
    );
    if (callback) {
      nextTick(callback.bind(this, err));
      return;
    } else throw err;
  }
  rounds = 1 << rounds >>> 0;
  var P, S, i = 0, j;
  if (typeof Int32Array === "function") {
    P = new Int32Array(P_ORIG);
    S = new Int32Array(S_ORIG);
  } else {
    P = P_ORIG.slice();
    S = S_ORIG.slice();
  }
  _ekskey(salt, b, P, S);
  function next() {
    if (progressCallback) progressCallback(i / rounds);
    if (i < rounds) {
      var start = Date.now();
      for (; i < rounds; ) {
        i = i + 1;
        _key(b, P, S);
        _key(salt, P, S);
        if (Date.now() - start > MAX_EXECUTION_TIME) break;
      }
    } else {
      for (i = 0; i < 64; i++)
        for (j = 0; j < clen >> 1; j++) _encipher(cdata, j << 1, P, S);
      var ret = [];
      for (i = 0; i < clen; i++)
        ret.push((cdata[i] >> 24 & 255) >>> 0), ret.push((cdata[i] >> 16 & 255) >>> 0), ret.push((cdata[i] >> 8 & 255) >>> 0), ret.push((cdata[i] & 255) >>> 0);
      if (callback) {
        callback(null, ret);
        return;
      } else return ret;
    }
    if (callback) nextTick(next);
  }
  if (typeof callback !== "undefined") {
    next();
  } else {
    var res;
    while (true) if (typeof (res = next()) !== "undefined") return res || [];
  }
}
function _hash(password, salt, callback, progressCallback) {
  var err;
  if (typeof password !== "string" || typeof salt !== "string") {
    err = Error("Invalid string / salt: Not a string");
    if (callback) {
      nextTick(callback.bind(this, err));
      return;
    } else throw err;
  }
  var minor, offset;
  if (salt.charAt(0) !== "$" || salt.charAt(1) !== "2") {
    err = Error("Invalid salt version: " + salt.substring(0, 2));
    if (callback) {
      nextTick(callback.bind(this, err));
      return;
    } else throw err;
  }
  if (salt.charAt(2) === "$") minor = String.fromCharCode(0), offset = 3;
  else {
    minor = salt.charAt(2);
    if (minor !== "a" && minor !== "b" && minor !== "y" || salt.charAt(3) !== "$") {
      err = Error("Invalid salt revision: " + salt.substring(2, 4));
      if (callback) {
        nextTick(callback.bind(this, err));
        return;
      } else throw err;
    }
    offset = 4;
  }
  if (salt.charAt(offset + 2) > "$") {
    err = Error("Missing salt rounds");
    if (callback) {
      nextTick(callback.bind(this, err));
      return;
    } else throw err;
  }
  var r1 = parseInt(salt.substring(offset, offset + 1), 10) * 10, r2 = parseInt(salt.substring(offset + 1, offset + 2), 10), rounds = r1 + r2, real_salt = salt.substring(offset + 3, offset + 25);
  password += minor >= "a" ? "\0" : "";
  var passwordb = utf8Array(password), saltb = base64_decode(real_salt, BCRYPT_SALT_LEN);
  function finish(bytes) {
    var res = [];
    res.push("$2");
    if (minor >= "a") res.push(minor);
    res.push("$");
    if (rounds < 10) res.push("0");
    res.push(rounds.toString());
    res.push("$");
    res.push(base64_encode(saltb, saltb.length));
    res.push(base64_encode(bytes, C_ORIG.length * 4 - 1));
    return res.join("");
  }
  if (typeof callback == "undefined")
    return finish(_crypt(passwordb, saltb, rounds));
  else {
    _crypt(
      passwordb,
      saltb,
      rounds,
      function(err2, bytes) {
        if (err2) callback(err2, null);
        else callback(null, finish(bytes));
      },
      progressCallback
    );
  }
}

// src/lib/server/token-manager.ts
function tokenExists() {
  return (0, import_fs5.existsSync)(getTokenHashPath());
}
async function generateAndPersistToken() {
  const hashPath = getTokenHashPath();
  if ((0, import_fs5.existsSync)(hashPath)) {
    throw new Error(
      `Token hash already exists at ${hashPath}. Call rotateToken() to replace it.`
    );
  }
  const token = (0, import_crypto2.randomBytes)(32).toString("hex");
  const hash2 = await hash(token, 12);
  (0, import_fs5.mkdirSync)((0, import_path6.dirname)(hashPath), { recursive: true });
  (0, import_fs5.writeFileSync)(hashPath, hash2, { encoding: "utf8", mode: 384 });
  return token;
}
async function rotateToken() {
  const hashPath = getTokenHashPath();
  if ((0, import_fs5.existsSync)(hashPath)) {
    (0, import_fs5.unlinkSync)(hashPath);
  }
  return generateAndPersistToken();
}

// src/cli/serve.ts
function printTokenBox(token) {
  console.log();
  console.log("\u2554\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2557");
  console.log("\u2551  Fleet API Token (shown once \u2014 store it securely)           \u2551");
  console.log("\u2551                                                              \u2551");
  console.log(`\u2551  ${token.padEnd(60)}  \u2551`);
  console.log("\u2551                                                              \u2551");
  console.log("\u2551  This token is required to connect clients to this server.  \u2551");
  console.log("\u2551  It will never be shown again. To rotate:                   \u2551");
  console.log("\u2551    weave-fleet serve --rotate-token                         \u2551");
  console.log("\u255A\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u255D");
  console.log();
}
function findServerJs() {
  const standaloneNext = (0, import_path7.join)(__dirname, "server.js");
  if ((0, import_fs6.existsSync)(standaloneNext)) {
    return standaloneNext;
  }
  const projectRoot = (0, import_path7.join)(__dirname, "..", "..");
  const devNext = (0, import_path7.join)(projectRoot, ".next", "standalone", "server.js");
  if ((0, import_fs6.existsSync)(devNext)) {
    return devNext;
  }
  const standaloneDir = (0, import_path7.join)(projectRoot, ".next", "standalone");
  if ((0, import_fs6.existsSync)(standaloneDir)) {
    const { readdirSync: readdirSync3 } = require("fs");
    for (const entry of readdirSync3(standaloneDir)) {
      const nested = (0, import_path7.join)(standaloneDir, entry, "server.js");
      if ((0, import_fs6.existsSync)(nested)) {
        return nested;
      }
    }
  }
  throw new Error(
    `Could not locate Next.js standalone server.js.
Run \`npm run build:standalone\` to produce the standalone output.
Looked in:
  ${standaloneNext}
  ${devNext}`
  );
}
async function runServe(options = {}) {
  if (options.rotateToken) {
    console.log("Rotating Fleet API token...");
    const newToken = await rotateToken();
    console.log();
    console.log("Token rotated successfully.");
    printTokenBox(newToken);
    console.log("Restart the server to use the new token.");
    return;
  }
  let plaintextToken;
  if (!tokenExists()) {
    console.log("Generating Fleet API token...");
    plaintextToken = await generateAndPersistToken();
    printTokenBox(plaintextToken);
  } else {
    console.log("Fleet API token loaded. Starting server...");
  }
  const hashPath = getTokenHashPath();
  let tokenHash;
  try {
    tokenHash = (0, import_fs6.readFileSync)(hashPath, { encoding: "utf8" }).trim();
  } catch (err) {
    console.error(`Warning: could not read token hash from ${hashPath}:`, err);
  }
  const resolvedPort = options.port ?? Number(process.env.FLEET_PORT ?? "3000");
  const resolvedHost = options.host ?? process.env.FLEET_HOST ?? "0.0.0.0";
  const serverJs = findServerJs();
  console.log(`Starting Fleet API server on ${resolvedHost}:${resolvedPort}`);
  console.log(`  server.js: ${serverJs}`);
  console.log();
  const childEnv = {
    ...process.env,
    PORT: String(resolvedPort),
    HOSTNAME: resolvedHost
  };
  if (tokenHash) {
    childEnv.FLEET_TOKEN_HASH = tokenHash;
  }
  if (options.injectToken && plaintextToken) {
    childEnv.FLEET_INJECT_TOKEN = plaintextToken;
  }
  const child = (0, import_child_process.spawn)("node", [serverJs], {
    env: childEnv,
    stdio: "inherit"
  });
  const forwardSignal = (signal) => {
    child.kill(signal);
  };
  process.on("SIGINT", () => forwardSignal("SIGINT"));
  process.on("SIGTERM", () => forwardSignal("SIGTERM"));
  child.on("exit", (code, signal) => {
    if (signal) {
      process.exit(0);
    } else {
      process.exit(code ?? 0);
    }
  });
  child.on("error", (err) => {
    console.error("Failed to start server:", err.message);
    process.exit(1);
  });
}

// src/cli/index.ts
var VERSION = "0.1.6";
function printUsage() {
  console.log(`weave-fleet CLI v${VERSION}`);
  console.log();
  console.log("Usage: weave-fleet <command> [options]");
  console.log();
  console.log("Commands:");
  console.log("  init <directory>              Initialize a project with skill configuration");
  console.log("  skill list                    List installed skills");
  console.log("  skill install <source>        Install a skill from URL or local path");
  console.log("  skill remove <name>           Remove an installed skill");
  console.log("  serve                         Start the Fleet API server (standalone mode)");
  console.log();
  console.log("Init Options:");
  console.log("  --force                       Overwrite existing configuration");
  console.log("  --dry-run                     Print what would be generated without writing");
  console.log();
  console.log("Skill Install Options:");
  console.log("  --force                       Overwrite existing skill");
  console.log("  --agent <agents>              Comma-separated agent names to assign the skill to");
  console.log();
  console.log("Sources for skill install:");
  console.log("  https://...                   Raw URL to a SKILL.md file");
  console.log("  github:user/repo/path         GitHub repository shorthand");
  console.log("  /path/to/SKILL.md             Local file path");
  console.log();
  console.log("Serve Options:");
  console.log("  --port <port>               Port to bind (default: 3000, env: FLEET_PORT)");
  console.log("  --host <host>               Host to bind (default: 0.0.0.0, env: FLEET_HOST)");
  console.log("  --rotate-token              Rotate the API token (server must be stopped)");
  console.log();
  console.log("Serve Environment Variables:");
  console.log("  FLEET_PORT                  Port to bind (overridden by --port)");
  console.log("  FLEET_HOST                  Host to bind (overridden by --host)");
  console.log("  FLEET_NAME                  Server display name (default: Fleet Server)");
  console.log("  FLEET_DESCRIPTION           Server description (default: empty)");
  console.log("  FLEET_ALLOWED_ORIGINS       Comma-separated allowed CORS origins (default: *)");
  console.log("  FLEET_AUTH_DISABLED         Set to 'true' to disable auth (dev mode only)");
}
function parseArgs(argv) {
  const command = argv[0] ?? "";
  const args = [];
  const flags = {};
  let i = 1;
  while (i < argv.length) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const flagName = arg.slice(2);
      if (i + 1 < argv.length && !argv[i + 1].startsWith("--")) {
        flags[flagName] = argv[i + 1];
        i += 2;
      } else {
        flags[flagName] = true;
        i++;
      }
    } else if (arg.startsWith("-")) {
      const flagName = arg.slice(1);
      flags[flagName] = true;
      i++;
    } else {
      args.push(arg);
      i++;
    }
  }
  return { command, args, flags };
}
async function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h" || argv[0] === "help") {
    printUsage();
    process.exit(0);
  }
  const { command, args, flags } = parseArgs(argv);
  switch (command) {
    case "init": {
      if (flags["help"] || flags["h"]) {
        console.log("Usage: weave-fleet init <directory> [--force] [--dry-run]");
        console.log();
        console.log("Initialize a project directory with Weave skill configuration.");
        console.log("Detects project technologies and generates .opencode/weave-opencode.jsonc");
        console.log();
        console.log("Options:");
        console.log("  --force     Overwrite existing configuration");
        console.log("  --dry-run   Print what would be generated without writing");
        process.exit(0);
      }
      const directory = args[0];
      if (!directory) {
        console.error("Error: directory argument is required.");
        console.error("Usage: weave-fleet init <directory>");
        process.exit(1);
      }
      try {
        const result = runInit(directory, {
          force: Boolean(flags["force"]),
          dryRun: Boolean(flags["dry-run"])
        });
        console.log();
        if (result.profile.languages.length > 0) {
          const techs = [
            ...result.profile.languages,
            ...result.profile.frameworks
          ].join(", ");
          console.log(`Detected: ${techs}`);
        } else {
          console.log("No specific language/framework detected.");
        }
        if (result.profile.isGitRepo) {
          console.log("Git repository: yes");
        }
        if (result.enabledSkills.length > 0) {
          console.log(`Enabled skills: ${result.enabledSkills.join(", ")}`);
        } else {
          console.log("No matching skills found (install skills with: weave-fleet skill install <source>)");
        }
        if (result.written) {
          console.log(`
Config written to: ${result.configPath}`);
        } else {
          console.log(`
Dry run \u2014 would write to: ${result.configPath}`);
        }
        console.log();
        console.log("Next steps:");
        console.log("  Run `weave-fleet` to start the dashboard");
        console.log("  Run `weave-fleet skill list` to see all available skills");
        console.log();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`Error: ${message}`);
        process.exit(1);
      }
      break;
    }
    case "skill": {
      const subCommand = args[0];
      if (!subCommand || flags["help"] || flags["h"]) {
        console.log("Usage: weave-fleet skill <subcommand> [options]");
        console.log();
        console.log("Subcommands:");
        console.log("  list                    List installed skills");
        console.log("  install <source>        Install a skill from URL or local path");
        console.log("  remove <name>           Remove an installed skill");
        process.exit(0);
      }
      switch (subCommand) {
        case "list":
          runSkillList();
          break;
        case "install": {
          const source = args[1];
          if (!source) {
            console.error("Error: source argument is required.");
            console.error("Usage: weave-fleet skill install <url-or-path> [--force] [--agent <agents>]");
            process.exit(1);
          }
          const agentStr = flags["agent"];
          const agents = typeof agentStr === "string" ? agentStr.split(",").map((a) => a.trim()) : void 0;
          await runSkillInstall(source, {
            force: Boolean(flags["force"]),
            agents
          });
          break;
        }
        case "remove": {
          const name = args[1];
          if (!name) {
            console.error("Error: skill name is required.");
            console.error("Usage: weave-fleet skill remove <name>");
            process.exit(1);
          }
          runSkillRemove(name);
          break;
        }
        default:
          console.error(`Unknown skill subcommand: ${subCommand}`);
          console.error("Run 'weave-fleet skill --help' for usage.");
          process.exit(1);
      }
      break;
    }
    case "serve": {
      const rotateTokenFlag = Boolean(flags["rotate-token"]);
      const portFlag = flags["port"] ? Number(flags["port"]) : void 0;
      const hostFlag = typeof flags["host"] === "string" ? flags["host"] : void 0;
      await runServe({ port: portFlag, host: hostFlag, rotateToken: rotateTokenFlag });
      break;
    }
    default:
      console.error(`Unknown command: ${command}`);
      console.error("Run 'weave-fleet --help' for usage.");
      process.exit(1);
  }
}
main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
