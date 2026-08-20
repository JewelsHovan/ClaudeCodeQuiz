// ============================================================
// DATAMON unified audio director
// One lazy AudioContext for adaptive music, ambience, UI, and SFX.
// Presentation-only: immutable scalar snapshots in, sound/diagnostics out.
// ============================================================
"use strict";

(function () {
  var TICK_MS = 25;
  var LOOKAHEAD_S = 0.10;
  var CROSSFADE_S = 0.75;
  var MAX_VOICES = 32;
  var MAX_MUSIC_VOICES = 24;
  var MAX_CUE_VOICES = 12;
  var MAX_EVENTS_PER_TICK = 32;
  var MAX_MUSIC_BUSES = 3;
  var MAX_TRANSITIONS = 32;
  var MAX_FAILURES = 16;
  var MAX_PENDING = 8;
  var MAX_DECODED_BYTES = 4 * 1024 * 1024;
  var MANIFEST_PATH = "audio/manifest.json";

  var BUS_DEFAULTS = Object.freeze({ master: 0.78, music: 0.86, ambience: 0.46, sfx: 0.82, ui: 0.72 });
  var VALID_ROLES = Object.freeze(["ambience", "footstep", "ui", "foley", "battle", "result"]);
  var VALID_FORMATS = Object.freeze(["mp3", "wav"]);

  var CUES = Object.freeze({
    "ui.navigate": { asset: "ui.navigate", bus: "ui", rateMs: 38, tones: [[760,.045,"square",.025]] },
    "ui.confirm": { asset: "ui.confirm", bus: "ui", rateMs: 55, tones: [[620,.07,"triangle",.035],[880,.08,"triangle",.025,.055]] },
    "ui.reject": { asset: "ui.reject", bus: "ui", rateMs: 90, duck: .88, tones: [[185,.14,"sawtooth",.035]] },
    "dialogue.advance": { asset: "ui.navigate", bus: "ui", rateMs: 45, tones: [[690,.04,"triangle",.022]] },
    "dialogue.choice": { asset: "ui.confirm", bus: "ui", rateMs: 70, tones: [[580,.06,"triangle",.028],[760,.07,"triangle",.024,.05]] },
    "world.chair-sit": { asset: "world.chair-sit", bus: "sfx", rateMs: 160, tones: [[118,.12,"triangle",.025]] },
    "world.chair-stand": { asset: "world.chair-stand", bus: "sfx", rateMs: 160, tones: [[152,.10,"triangle",.022]] },
    "world.page": { asset: "world.page", bus: "sfx", rateMs: 90, tones: [[920,.035,"triangle",.018],[620,.045,"triangle",.015,.04]] },
    "world.door": { asset: "world.door", bus: "sfx", rateMs: 300, duck: .82, tones: [[220,.12,"triangle",.03],[440,.16,"triangle",.025,.09]] },
    "world.coffee": { asset: "world.coffee", bus: "sfx", rateMs: 300, tones: [[310,.16,"sine",.025],[620,.12,"triangle",.022,.14]] },
    "world.console": { asset: "world.console", bus: "sfx", rateMs: 180, duck: .86, tones: [[540,.06,"square",.026],[810,.08,"triangle",.025,.07]] },
    "battle.transition": { asset: "battle.transition", bus: "sfx", rateMs: 450, duck: .62, tones: [[392,.12,"square",.04],[311,.16,"square",.04,.14]] },
    "battle.sendout": { asset: "battle.sendout", bus: "sfx", rateMs: 220, duck: .70, tones: [[420,.08,"square",.035],[720,.12,"triangle",.035,.08]] },
    "battle.hit": { asset: "battle.hit", bus: "sfx", rateMs: 120, duck: .58, tones: [[150,.17,"sawtooth",.04]] },
    "battle.block": { asset: "battle.block", bus: "sfx", rateMs: 140, duck: .64, tones: [[520,.06,"triangle",.035],[520,.09,"triangle",.035,.06]] },
    "battle.heal": { asset: "battle.heal", bus: "sfx", rateMs: 140, duck: .72, tones: [[520,.07,"triangle",.03],[780,.12,"triangle",.035,.07]] },
    "battle.faint": { asset: "battle.faint", bus: "sfx", rateMs: 180, duck: .62, tones: [[360,.10,"square",.035],[220,.18,"triangle",.028,.08]] },
    "battle.flee": { asset: "battle.flee", bus: "sfx", rateMs: 240, duck: .76, tones: [[330,.06,"triangle",.028],[660,.12,"triangle",.03,.06]] },
    "result.correct": { asset: "result.correct", bus: "sfx", rateMs: 150, duck: .52, tones: [[523,.09,"square",.038],[659,.09,"square",.038,.09],[784,.14,"square",.04,.18]] },
    "result.wrong": { asset: "result.wrong", bus: "sfx", rateMs: 150, duck: .48, tones: [[220,.18,"sawtooth",.04],[160,.22,"sawtooth",.035,.12]] },
    "result.victory": { asset: "result.victory", bus: "sfx", rateMs: 500, duck: .38, tones: [[523,.12,"triangle",.038],[659,.12,"triangle",.038,.11],[784,.18,"triangle",.04,.22]] },
    "result.defeat": { asset: "result.defeat", bus: "sfx", rateMs: 500, duck: .38, tones: [[280,.18,"sawtooth",.034],[210,.24,"sawtooth",.03,.15]] },
    "agent.navigate": { asset: "ui.navigate", bus: "ui", rateMs: 38, tones: [[760,.045,"square",.022]] },
    "agent.confirm": { asset: "ui.confirm", bus: "ui", rateMs: 55, tones: [[620,.07,"triangle",.03]] },
    "agent.rejected": { asset: "ui.reject", bus: "ui", rateMs: 90, duck: .84, tones: [[180,.14,"sawtooth",.035]] },
    "agent.query": { asset: "world.console", bus: "sfx", rateMs: 90, duck: .78, tones: [[520,.06,"square",.032],[760,.08,"square",.032,.055]] },
    "agent.inspect": { asset: "world.console", bus: "sfx", rateMs: 90, duck: .78, tones: [[440,.07,"triangle",.032],[880,.09,"triangle",.032,.065]] },
    "agent.patch": { asset: "battle.block", bus: "sfx", rateMs: 90, duck: .68, tones: [[330,.08,"triangle",.032],[520,.12,"triangle",.034,.07]] },
    "agent.escalate": { asset: "battle.transition", bus: "sfx", rateMs: 120, duck: .54, tones: [[260,.06,"sawtooth",.032],[440,.07,"sawtooth",.036,.055],[700,.12,"square",.04,.11]] },
    "agent.correct": { asset: "result.correct", bus: "sfx", rateMs: 140, duck: .50, tones: [[780,.08,"square",.038],[1040,.12,"triangle",.04,.075]] },
    "agent.wrong": { asset: "result.wrong", bus: "sfx", rateMs: 140, duck: .46, tones: [[210,.18,"sawtooth",.038]] },
    "agent.blocked": { asset: "battle.block", bus: "sfx", rateMs: 140, duck: .58, tones: [[520,.07,"triangle",.036],[520,.09,"triangle",.036,.06]] },
    "agent.phase": { asset: "battle.transition", bus: "sfx", rateMs: 220, duck: .42, tones: [[390,.07,"triangle",.034],[520,.08,"triangle",.038,.07],[660,.12,"triangle",.04,.14]] },
    "agent.victory": { asset: "result.victory", bus: "sfx", rateMs: 500, duck: .34, tones: [[520,.10,"triangle",.038],[660,.10,"triangle",.038,.09],[780,.18,"triangle",.04,.18]] },
    "agent.defeat": { asset: "result.defeat", bus: "sfx", rateMs: 500, duck: .34, tones: [[280,.20,"sawtooth",.034],[210,.24,"sawtooth",.032,.15]] },
  });

  function finite(value, fallback) { return Number.isFinite(value) ? value : fallback; }
  function clamp(value, low, high) { return Math.max(low, Math.min(high, value)); }
  function safeId(value) { return typeof value === "string" && /^[a-z0-9][a-z0-9.-]*$/.test(value) ? value : ""; }
  function safeFile(value) { return typeof value === "string" && /^[a-z0-9][a-z0-9.-]*\.(mp3|wav)$/.test(value) ? value : ""; }

  function normalizeManifest(raw) {
    if (!raw || raw.schemaVersion !== 1 || raw.reviewState !== "accepted" || !Array.isArray(raw.assets)) return null;
    var ids = Object.create(null), files = Object.create(null), assets = [], aggregate = 0;
    for (var i = 0; i < raw.assets.length; i++) {
      var item = raw.assets[i] || {}, id = safeId(item.id), file = safeFile(item.file);
      if (!id || !file || ids[id] || files[file]) return null;
      if (VALID_ROLES.indexOf(item.role) < 0 || VALID_FORMATS.indexOf(item.format) < 0) return null;
      if (file.slice(-(item.format.length + 1)) !== "." + item.format) return null;
      if (!Number.isInteger(item.bytes) || item.bytes <= 0 || !/^[0-9a-f]{64}$/.test(item.sha256 || "")) return null;
      if (item.channels !== 1 || !Number.isInteger(item.sampleRate) || item.sampleRate < 8000 || item.sampleRate > 48000) return null;
      if (!Number.isInteger(item.durationMs) || item.durationMs <= 0 || item.durationMs > 30000) return null;
      if (!Number.isFinite(item.gain) || item.gain <= 0 || item.gain > 1) return null;
      var loop = null;
      if (item.loop != null) {
        if (!Number.isInteger(item.loop.startMs) || !Number.isInteger(item.loop.endMs) || item.loop.startMs < 0 || item.loop.startMs >= item.loop.endMs || item.loop.endMs > item.durationMs) return null;
        loop = Object.freeze({ startMs: item.loop.startMs, endMs: item.loop.endMs });
      }
      if (!item.provenance || item.provenance.reviewState !== "accepted" || item.provenance.kind !== "deterministic-local-synthesis") return null;
      ids[id] = true; files[file] = true; aggregate += item.bytes;
      assets.push(Object.freeze({ id:id, file:file, format:item.format, role:item.role, bytes:item.bytes,
        sha256:item.sha256, channels:item.channels, sampleRate:item.sampleRate, durationMs:item.durationMs,
        gain:item.gain, preload:item.preload === "scene" ? "scene" : "on-demand", loop:loop }));
    }
    if (raw.assetCount !== assets.length || raw.aggregateBytes !== aggregate || aggregate > 1024 * 1024) return null;
    return Object.freeze({ assets:Object.freeze(assets), aggregateBytes:aggregate, assetCount:assets.length });
  }

  function surfaceForTile(tile, currentMap) {
    if (currentMap === "library") return "carpet";
    if (currentMap === "battleRoom") return "tile";
    if (["R", "T", "K", "A", "X"].indexOf(String(tile || "")) >= 0) return "tile";
    return "wood";
  }

  function resolveAudioState(snapshot) {
    snapshot = snapshot || {};
    var music = typeof DatamonMusic !== "undefined" ? DatamonMusic.resolveScene(snapshot) : "title";
    var ambience = null;
    var map = snapshot.currentMap;
    var state = snapshot.state || "title";
    if (["overworld", "search", "dialogue", "minigame"].indexOf(state) >= 0) {
      ambience = map === "library" ? "ambience.library" : map === "battleRoom" ? "ambience.battle-room" : "ambience.office";
    }
    var overlay = String(snapshot.overlay || "");
    var focus = ["dialogue", "mentor", "console", "reader", "search"].indexOf(overlay) >= 0 || state === "dialogue";
    return Object.freeze({ music: music, ambience: ambience, overlay: overlay || null,
      focus: focus, region: String(snapshot.region || ""), surface: String(snapshot.surface || "wood") });
  }

  function paramSet(param, value, time) {
    if (!param) return;
    if (typeof param.setValueAtTime === "function") param.setValueAtTime(value, time); else param.value = value;
  }
  function paramLinear(param, value, time) {
    if (!param) return;
    if (typeof param.linearRampToValueAtTime === "function") param.linearRampToValueAtTime(value, time); else param.value = value;
  }
  function paramExp(param, value, time) {
    if (!param) return;
    if (typeof param.exponentialRampToValueAtTime === "function") param.exponentialRampToValueAtTime(value, time); else param.value = value;
  }
  function paramCancel(param, time) { if (param && typeof param.cancelScheduledValues === "function") param.cancelScheduledValues(time); }

  var context = null, limiter = null, buses = null;
  var available = true, unlocked = false, muted = false, suspended = false;
  var contextCreations = 0, graphCreations = 0;
  var busLevels = { master:BUS_DEFAULTS.master, music:BUS_DEFAULTS.music, ambience:BUS_DEFAULTS.ambience, sfx:BUS_DEFAULTS.sfx, ui:BUS_DEFAULTS.ui };
  var snapshot = null, resolved = resolveAudioState({ state:"title" });
  var generation = 0, currentMusicScene = null, currentScore = null, currentMusicBus = null;
  var retiringMusicBuses = [], stepIndex = 0, nextStepTime = 0, completedOneShot = false;
  var schedulerId = null, schedulerStarts = 0, droppedCatchups = 0;
  var voices = [], noiseBuffer = null, transitions = [], failures = [];
  var manifest = null, manifestPromise = null, assetById = Object.create(null);
  var pendingAssets = new Map(), decodedAssets = new Map(), decodedBytes = 0, assetUses = 0;
  var ambienceRecords = [], ambienceGeneration = 0;
  var timers = new Set(), lastCueAt = Object.create(null), cueCounts = Object.create(null);
  var droppedCues = 0, duckCount = 0, eventSequence = 0;

  function recordFailure(code) {
    failures.push(String(code || "unknown"));
    if (failures.length > MAX_FAILURES) failures.shift();
  }

  function failSilent(code) {
    recordFailure(code);
    available = false;
    unlocked = false;
    generation++;
    stopScheduler();
    stopAllSources();
    clearTimers();
    if (currentMusicBus) disposeMusicBus(currentMusicBus);
    retiringMusicBuses.forEach(disposeMusicBus);
    retiringMusicBuses = [];
    currentMusicBus = null;
    var failed = context;
    context = null; buses = null; limiter = null; noiseBuffer = null;
    if (failed && typeof failed.close === "function") {
      try { var result = failed.close(); if (result && result.catch) result.catch(function () {}); } catch (_) {}
    }
    return false;
  }

  function makeGain(value) {
    var node = context.createGain();
    if (!node || !node.gain || typeof node.connect !== "function") throw new Error("gain-unavailable");
    node.gain.value = value;
    return node;
  }

  function ensureContext() {
    if (!available) return false;
    if (context && context.state !== "closed") return true;
    try {
      var Ctor = window.AudioContext || window.webkitAudioContext;
      if (typeof Ctor !== "function") return failSilent("context-unavailable");
      context = new Ctor();
      contextCreations++;
      var master = makeGain(muted ? 0 : busLevels.master);
      buses = { master:master, music:makeGain(busLevels.music), ambience:makeGain(busLevels.ambience), sfx:makeGain(busLevels.sfx), ui:makeGain(busLevels.ui) };
      buses.music.connect(master); buses.ambience.connect(master); buses.sfx.connect(master); buses.ui.connect(master);
      limiter = typeof context.createDynamicsCompressor === "function" ? context.createDynamicsCompressor() : null;
      if (limiter && typeof limiter.connect === "function") { master.connect(limiter); limiter.connect(context.destination); }
      else master.connect(context.destination);
      graphCreations++;
      applyFocus();
      return true;
    } catch (error) {
      return failSilent("context-create");
    }
  }

  function scheduleTimer(fn, delay) {
    var timer = setTimeout(function () { timers.delete(timer); fn(); }, Math.max(0, delay));
    timers.add(timer); return timer;
  }
  function clearTimers() { timers.forEach(function (timer) { clearTimeout(timer); }); timers.clear(); }

  function removeVoice(record) {
    var index = voices.indexOf(record);
    if (index >= 0) voices.splice(index, 1);
  }
  function stopVoice(record) {
    if (!record || record.ended) return;
    record.ended = true;
    try { record.source.onended = null; record.source.stop(); } catch (_) {}
    try { if (record.source.disconnect) record.source.disconnect(); } catch (_) {}
    try { if (record.gain && record.gain.disconnect) record.gain.disconnect(); } catch (_) {}
    removeVoice(record);
  }
  function pruneVoices() {
    voices = voices.filter(function (voice) { return !voice.ended; });
  }
  function voiceCount(group) {
    return voices.filter(function (voice) { return !voice.ended && (!group || voice.group === group); }).length;
  }
  function ambienceCount() { return ambienceRecords.filter(function (record) { return !record.ended; }).length; }
  function totalVoiceCount() { return voices.length + ambienceCount(); }
  function registerVoice(source, gain, group, assetId) {
    pruneVoices();
    while (totalVoiceCount() >= MAX_VOICES || (group === "music" && voiceCount("music") >= MAX_MUSIC_VOICES) || (group !== "music" && voiceCount("music") < voices.length && voices.length - voiceCount("music") >= MAX_CUE_VOICES)) {
      var candidate = voices.find(function (voice) { return voice.group !== "ambience"; }) || voices[0];
      if (!candidate) break;
      stopVoice(candidate);
    }
    var record = { source:source, gain:gain, group:group, assetId:assetId || null, ended:false };
    voices.push(record);
    source.onended = function () { record.ended = true; removeVoice(record); };
    return record;
  }
  function stopGroup(group) {
    voices.slice().forEach(function (voice) { if (!group || voice.group === group) stopVoice(voice); });
    if (!group || group === "ambience") stopAmbience(true);
  }
  function stopAllSources() { voices.slice().forEach(stopVoice); voices = []; stopAmbience(true); }

  function makeNoiseBuffer() {
    if (noiseBuffer || !context || typeof context.createBuffer !== "function") return noiseBuffer;
    var sampleRate = context.sampleRate || 44100, length = Math.max(1, Math.floor(sampleRate * .25));
    noiseBuffer = context.createBuffer(1, length, sampleRate);
    var data = noiseBuffer.getChannelData(0), seed = 0xDA7A2026;
    for (var i = 0; i < length; i++) { seed = (Math.imul(seed,1664525)+1013904223)>>>0; data[i] = (seed/4294967296*2-1)*(1-i/length); }
    return noiseBuffer;
  }

  function scheduleMusicVoice(instrument, note, when, duration, amount, destination) {
    if (!context || muted || suspended || !destination || voices.length >= MAX_VOICES) return false;
    try {
      var source, gain = makeGain(.0001), filter = typeof context.createBiquadFilter === "function" ? context.createBiquadFilter() : null;
      paramSet(gain.gain,.0001,when); paramExp(gain.gain,Math.max(.0002,amount),when+.006); paramExp(gain.gain,.0001,when+duration+Math.max(.03,duration*.45));
      if (instrument === "hat") {
        if (typeof context.createBufferSource !== "function") return false;
        source = context.createBufferSource(); source.buffer = makeNoiseBuffer();
        if (filter) { filter.type="highpass"; filter.frequency.value=4500; }
      } else {
        if (typeof context.createOscillator !== "function") return false;
        source = context.createOscillator(); source.type = instrument === "pad" || instrument === "bass" ? "triangle" : instrument === "bell" ? "sine" : "square";
        source.frequency.value = DatamonMusic.midiToHz(note);
        if (filter) { filter.type="lowpass"; filter.frequency.value = instrument === "drive" ? 1200 : instrument === "pad" ? 900 : 2600; }
      }
      if (filter) { source.connect(filter); filter.connect(gain); } else source.connect(gain);
      gain.connect(destination); registerVoice(source,gain,"music");
      source.start(when); source.stop(when+duration+Math.max(.03,duration*.45)+.02); return true;
    } catch (_) { recordFailure("music-voice"); return false; }
  }

  function scheduleStep(score, step, when) {
    var events = 0, sixteenth = 60 / score.tempo / 4;
    for (var i=0; i<score.layers.length && events<MAX_EVENTS_PER_TICK; i++) {
      var layer=score.layers[i]; if (step % layer.division !== 0) continue;
      var offset=layer.pattern[Math.floor(step/layer.division)%layer.pattern.length];
      if (offset == null) continue;
      if (scheduleMusicVoice(layer.instrument,score.root+offset,when,Math.max(.025,layer.duration),layer.gain,currentMusicBus && currentMusicBus.gain)) events++;
    }
    return { duration:sixteenth, events:events };
  }

  function schedulerTick() {
    if (!context || !unlocked || muted || suspended || !currentScore || !currentMusicBus) return;
    var now=context.currentTime, horizon=now+LOOKAHEAD_S, events=0, guard=0;
    if (nextStepTime < now-.35) { nextStepTime=now+.025; droppedCatchups++; }
    cleanupMusicBuses(now);
    while (nextStepTime<horizon && events<MAX_EVENTS_PER_TICK && guard<64) {
      var result=scheduleStep(currentScore,stepIndex,nextStepTime); events+=result.events; stepIndex++;
      if (stepIndex>=currentScore.steps) {
        if (currentScore.loop) stepIndex=0;
        else { completedOneShot=true; currentScore=null; break; }
      }
      nextStepTime+=result.duration; guard++;
    }
    pruneVoices(); if (completedOneShot) stopScheduler();
  }
  function ensureScheduler() {
    if (schedulerId!==null || !context || !unlocked || muted || suspended || !currentScore || !currentMusicBus) return;
    schedulerId=setInterval(function(){try{schedulerTick();}catch(_){recordFailure("scheduler");stopScheduler();}},TICK_MS); schedulerStarts++;
  }
  function stopScheduler() { if (schedulerId!==null) clearInterval(schedulerId); schedulerId=null; }

  function disposeMusicBus(record) { if (!record || record.disposed) return; try{record.gain.disconnect();}catch(_){} record.disposed=true; }
  function cleanupMusicBuses(now) {
    for (var i=retiringMusicBuses.length-1;i>=0;i--) if (now>=retiringMusicBuses[i].disposeAt) { disposeMusicBus(retiringMusicBuses[i]); retiringMusicBuses.splice(i,1); }
    while (retiringMusicBuses.length+(currentMusicBus?1:0)>MAX_MUSIC_BUSES) disposeMusicBus(retiringMusicBuses.shift());
  }

  function setMusicScene(scene) {
    var scores=typeof DatamonMusic!=="undefined"?DatamonMusic.SCORES:{};
    if (!scores[scene]) scene="title";
    if (scene===currentMusicScene) return false;
    currentMusicScene=scene; currentScore=scores[scene]; generation++; stepIndex=0; completedOneShot=false;
    transitions.push(scene); if(transitions.length>MAX_TRANSITIONS) transitions.shift();
    if (!context || !buses || muted || suspended) return true;
    try {
      var now=context.currentTime;
      if(currentMusicBus){var old=currentMusicBus;paramCancel(old.gain.gain,now);paramSet(old.gain.gain,old.gain.gain.value||.0001,now);paramLinear(old.gain.gain,.0001,now+CROSSFADE_S);old.disposeAt=now+CROSSFADE_S+.05;retiringMusicBuses.push(old);}
      var gain=makeGain(.0001);gain.connect(buses.music);paramLinear(gain.gain,currentScore.volume,now+CROSSFADE_S);
      currentMusicBus={gain:gain,scene:scene,disposeAt:Infinity,disposed:false};nextStepTime=now+.025;cleanupMusicBuses(now);ensureScheduler();return true;
    } catch(_){recordFailure("music-scene");return false;}
  }

  function loadManifest() {
    if (manifest) return Promise.resolve(manifest);
    if (manifestPromise) return manifestPromise;
    if (typeof fetch!=="function") { recordFailure("manifest-fetch-unavailable"); return Promise.resolve(null); }
    manifestPromise=fetch(MANIFEST_PATH,{cache:"force-cache"}).then(function(response){if(!response.ok)throw new Error("http-"+response.status);return response.json();})
      .then(function(raw){var normalized=normalizeManifest(raw);if(!normalized)throw new Error("manifest-invalid");manifest=normalized;assetById=Object.create(null);normalized.assets.forEach(function(item){assetById[item.id]=item;});return manifest;})
      .catch(function(error){recordFailure(error && error.message || "manifest-load");return null;});
    return manifestPromise;
  }

  function bytesHex(buffer) { return Array.from(new Uint8Array(buffer)).map(function(value){return value.toString(16).padStart(2,"0");}).join(""); }
  function verifyHash(buffer, expected) {
    if (typeof crypto==="undefined" || !crypto.subtle || typeof crypto.subtle.digest!=="function") return Promise.resolve(true);
    return crypto.subtle.digest("SHA-256",buffer.slice(0)).then(function(hash){return bytesHex(hash)===expected;}).catch(function(){return false;});
  }
  function decodeBuffer(bytes) {
    return new Promise(function(resolve,reject){
      try { var done=false;var result=context.decodeAudioData(bytes.slice(0),function(value){if(!done){done=true;resolve(value);}},function(error){if(!done){done=true;reject(error);}});if(result&&typeof result.then==="function")result.then(function(value){if(!done){done=true;resolve(value);}},function(error){if(!done){done=true;reject(error);}}); }
      catch(error){reject(error);}
    });
  }
  function touchDecoded(id) { var record=decodedAssets.get(id);if(record){decodedAssets.delete(id);decodedAssets.set(id,record);}return record; }
  function evictDecoded(required) {
    var active=Object.create(null);voices.forEach(function(v){if(v.assetId)active[v.assetId]=true;});ambienceRecords.forEach(function(v){if(v.assetId)active[v.assetId]=true;});
    while(decodedBytes+required>MAX_DECODED_BYTES&&decodedAssets.size){var first=decodedAssets.keys().next().value;if(active[first]){var held=decodedAssets.get(first);decodedAssets.delete(first);decodedAssets.set(first,held);if(Object.keys(active).length>=decodedAssets.size)break;continue;}var old=decodedAssets.get(first);decodedAssets.delete(first);decodedBytes-=old.decodedBytes;}
  }
  function ensureAsset(id) {
    var existing=touchDecoded(id);if(existing){assetUses++;return Promise.resolve(existing);}
    if(pendingAssets.has(id))return pendingAssets.get(id);
    if(pendingAssets.size>=MAX_PENDING){recordFailure("asset-pending-cap");return Promise.resolve(null);}
    var promise=loadManifest().then(function(){
      var entry=assetById[id];if(!entry||!context||typeof context.decodeAudioData!=="function")return null;
      return fetch("audio/"+entry.file,{cache:"force-cache"}).then(function(response){if(!response.ok)throw new Error("asset-http-"+response.status);return response.arrayBuffer();})
        .then(function(bytes){if(bytes.byteLength!==entry.bytes)throw new Error("asset-bytes");return verifyHash(bytes,entry.sha256).then(function(ok){if(!ok)throw new Error("asset-hash");return decodeBuffer(bytes);});})
        .then(function(buffer){var size=Math.ceil((buffer.length||Math.round(buffer.duration*entry.sampleRate))*entry.channels*4);evictDecoded(size);if(decodedBytes+size>MAX_DECODED_BYTES){recordFailure("decoded-cap");return null;}var record={entry:entry,buffer:buffer,decodedBytes:size};decodedAssets.set(id,record);decodedBytes+=size;return record;});
    }).catch(function(error){recordFailure(error&&error.message||"asset-load");return null;}).finally(function(){pendingAssets.delete(id);});
    pendingAssets.set(id,promise);return promise;
  }

  function startAmbience(id) {
    if(id===null){stopAmbience(false);return;}
    if(ambienceRecords.some(function(record){return record.assetId===id&&!record.ended;}))return;
    var token=++ambienceGeneration;
    ensureAsset(id).then(function(record){
      if(!record||token!==ambienceGeneration||muted||suspended||!context||!buses)return;
      try{
        while(totalVoiceCount()>=MAX_VOICES&&voices.length)stopVoice(voices.find(function(voice){return voice.group!=="music";})||voices[0]);
        var now=context.currentTime,source=context.createBufferSource(),gain=makeGain(.0001),entry=record.entry;
        source.buffer=record.buffer;source.loop=true;if(entry.loop){source.loopStart=entry.loop.startMs/1000;source.loopEnd=entry.loop.endMs/1000;}
        source.connect(gain);gain.connect(buses.ambience);paramLinear(gain.gain,entry.gain,now+CROSSFADE_S);
        var ambience={source:source,gain:gain,group:"ambience",assetId:id,ended:false};ambienceRecords.push(ambience);source.onended=function(){ambience.ended=true;ambienceRecords=ambienceRecords.filter(function(item){return item!==ambience;});};source.start(now);
        ambienceRecords.slice().forEach(function(old){if(old!==ambience&&!old.ended){paramCancel(old.gain.gain,now);paramSet(old.gain.gain,old.gain.gain.value||.0001,now);paramLinear(old.gain.gain,.0001,now+CROSSFADE_S);scheduleTimer(function(){stopAmbienceRecord(old);},(CROSSFADE_S+.05)*1000);}});
      }catch(_){recordFailure("ambience-start");}
    });
  }
  function stopAmbienceRecord(record){if(!record||record.ended)return;record.ended=true;try{record.source.onended=null;record.source.stop();}catch(_){}try{record.source.disconnect();record.gain.disconnect();}catch(_){}ambienceRecords=ambienceRecords.filter(function(item){return item!==record;});}
  function stopAmbience(immediate){ambienceGeneration++;var now=context?context.currentTime:0;ambienceRecords.slice().forEach(function(record){if(!immediate&&record.gain){paramCancel(record.gain.gain,now);paramSet(record.gain.gain,record.gain.gain.value||.0001,now);paramLinear(record.gain.gain,.0001,now+.12);scheduleTimer(function(){stopAmbienceRecord(record);},150);}else stopAmbienceRecord(record);});}

  function playSample(record,busName,group){
    if(!record||!context||!buses||muted||suspended||typeof context.createBufferSource!=="function")return false;
    try{var source=context.createBufferSource(),gain=makeGain(record.entry.gain);source.buffer=record.buffer;source.connect(gain);gain.connect(buses[busName]||buses.sfx);registerVoice(source,gain,group,record.entry.id);source.start(context.currentTime);source.stop(context.currentTime+Math.max(.03,record.buffer.duration||record.entry.durationMs/1000)+.02);return true;}catch(_){recordFailure("sample-play");return false;}
  }
  function playTone(tone,busName,group){
    if(!context||!buses||muted||suspended||typeof context.createOscillator!=="function")return false;
    try{var source=context.createOscillator(),gain=makeGain(.0001),when=context.currentTime+(tone[4]||0),duration=tone[1];source.type=tone[2]||"square";source.frequency.value=tone[0];paramSet(gain.gain,Math.max(.0001,tone[3]||.025),when);paramExp(gain.gain,.0001,when+duration);source.connect(gain);gain.connect(buses[busName]||buses.sfx);registerVoice(source,gain,group);source.start(when);source.stop(when+duration+.01);return true;}catch(_){recordFailure("tone-play");return false;}
  }

  function duck(amount){
    if(!context||!buses||muted)return;duckCount++;var now=context.currentTime,musicTarget=busLevels.music*(resolved.focus ? .62 : 1),ambientTarget=busLevels.ambience*(resolved.focus ? .58 : 1),factor=clamp(amount||.65,.25,.95);
    [buses.music,buses.ambience].forEach(function(bus,index){var target=index?ambientTarget:musicTarget;paramCancel(bus.gain,now);paramSet(bus.gain,bus.gain.value||target,now);paramLinear(bus.gain,Math.max(.0001,target*factor),now+.012);paramLinear(bus.gain,target,now+.24);});
  }
  function cue(id,detail){
    if(muted||suspended||!unlocked||!ensureContext())return false;
    detail=detail||{};var spec,assetId=id,group=String(detail.group||"");
    if(id==="footstep"){
      var surface=["carpet","wood","tile"].indexOf(detail.surface)>=0?detail.surface:"wood";eventSequence++;assetId="footstep."+surface+"."+(eventSequence%2+1);spec={asset:assetId,bus:"sfx",rateMs:detail.gait==="run"?42:65,tones:[[surface==="carpet"?92:surface==="tile"?176:138,.045,"triangle",detail.gait==="run"?.032:.024]]};group="footstep";
    }else spec=CUES[id];
    if(!spec){droppedCues++;return false;}
    var nowMs=typeof performance!=="undefined"&&performance.now?performance.now():Date.now(),last=lastCueAt[id]||-Infinity;
    if(nowMs-last<spec.rateMs){droppedCues++;return false;}lastCueAt[id]=nowMs;cueCounts[id]=(cueCounts[id]||0)+1;if(spec.duck)duck(spec.duck);
    var cached=touchDecoded(spec.asset);if(cached)playSample(cached,spec.bus,group||id.split(".")[0]);else{ensureAsset(spec.asset);(spec.tones||[]).forEach(function(tone){playTone(tone,spec.bus,group||id.split(".")[0]);});}
    return true;
  }

  function applyFocus(){
    if(!context||!buses)return;var now=context.currentTime,music=busLevels.music*(resolved.focus ? .62 : 1),ambience=busLevels.ambience*(resolved.focus ? .58 : 1);paramCancel(buses.music.gain,now);paramLinear(buses.music.gain,music,now+.18);paramCancel(buses.ambience.gain,now);paramLinear(buses.ambience.gain,ambience,now+.18);
  }
  function setSnapshot(next){snapshot=next&&typeof next==="object"?Object.assign({},next):{};var nextResolved=resolveAudioState(snapshot),changed=nextResolved.music!==resolved.music||nextResolved.ambience!==resolved.ambience||nextResolved.overlay!==resolved.overlay||nextResolved.focus!==resolved.focus||nextResolved.region!==resolved.region||nextResolved.surface!==resolved.surface;resolved=nextResolved;if(!changed)return false;applyFocus();setMusicScene(resolved.music);if(unlocked&&!muted&&!suspended)startAmbience(resolved.ambience);return true;}

  function unlock(){
    if(muted)return false;if(!ensureContext())return false;unlocked=true;suspended=false;
    try{var resumed=context.state==="suspended"&&typeof context.resume==="function"?context.resume():null;if(resumed&&resumed.catch)resumed.catch(function(){failSilent("resume-denied");});}catch(_){return failSilent("resume");}
    loadManifest();if(!currentMusicScene)setMusicScene(resolved.music||"title");else if(!currentMusicBus){var scene=currentMusicScene;currentMusicScene=null;setMusicScene(scene);}startAmbience(resolved.ambience);ensureScheduler();return true;
  }
  function setMuted(value){muted=!!value;if(!context||!buses)return;var now=context.currentTime;paramCancel(buses.master.gain,now);paramSet(buses.master.gain,muted?0:busLevels.master,now);if(muted){generation++;stopScheduler();stopAllSources();clearTimers();if(currentMusicBus)disposeMusicBus(currentMusicBus);retiringMusicBuses.forEach(disposeMusicBus);retiringMusicBuses=[];currentMusicBus=null;}else if(unlocked&&!suspended){if(!completedOneShot){var scene=currentMusicScene||resolved.music;currentMusicScene=null;setMusicScene(scene);}startAmbience(resolved.ambience);}}
  function setBusGain(name,value){if(!Object.prototype.hasOwnProperty.call(busLevels,name))return false;value=clamp(finite(Number(value),busLevels[name]),0,1);busLevels[name]=value;if(context&&buses){if(name==="master")paramSet(buses.master.gain,muted?0:value,context.currentTime);else applyFocus();}return true;}
  function suspend(){suspended=true;generation++;stopScheduler();stopAllSources();clearTimers();if(context&&typeof context.suspend==="function")try{var result=context.suspend();if(result&&result.catch)result.catch(function(){});}catch(_){} }
  function resume(){if(!unlocked||muted||!context)return;suspended=false;try{var result=typeof context.resume==="function"&&context.resume();if(result&&result.catch)result.catch(function(){failSilent("resume-denied");});}catch(_){failSilent("resume");return;}if(snapshot&&!completedOneShot){var scene=currentMusicScene||resolved.music;currentMusicScene=null;setMusicScene(scene);}if(snapshot)startAmbience(resolved.ambience);}
  function reset(){generation++;ambienceGeneration++;stopScheduler();stopAllSources();clearTimers();if(currentMusicBus)disposeMusicBus(currentMusicBus);retiringMusicBuses.forEach(disposeMusicBus);retiringMusicBuses=[];currentMusicBus=null;currentMusicScene=null;currentScore=null;stepIndex=0;completedOneShot=false;snapshot=null;resolved=resolveAudioState({state:"title"});}
  function cancelGroup(group){stopGroup(group);}
  function init(options){options=options||{};muted=!!options.muted;if(options.snapshot)setSnapshot(options.snapshot);else if(options.scene){resolved=Object.freeze({music:options.scene,ambience:null,overlay:null,focus:false,region:"",surface:"wood"});currentMusicScene=options.scene;}}

  function getDiagnostics(){pruneVoices();return{
    available:available,contextCreations:contextCreations,graphCreations:graphCreations,contextState:context?context.state:null,unlocked:unlocked,muted:muted,suspended:suspended,
    scene:currentMusicScene,tempo:currentMusicScene&&DatamonMusic.SCORES[currentMusicScene]?DatamonMusic.SCORES[currentMusicScene].tempo:null,schedulerActive:schedulerId!==null,schedulerStarts:schedulerStarts,
    activeVoices:totalVoiceCount(),musicVoices:voiceCount("music"),cueVoices:voices.length-voiceCount("music"),ambienceVoices:ambienceCount(),buses:buses?5:0,retiringBuses:retiringMusicBuses.length,generation:generation,step:stepIndex,oneShotComplete:completedOneShot,
    transitions:transitions.slice(),noiseBuffers:noiseBuffer?1:0,resolved:Object.assign({},resolved),ambience:ambienceRecords.filter(function(r){return!r.ended;}).map(function(r){return r.assetId;}),
    manifestLoaded:!!manifest,manifestAssets:manifest?manifest.assetCount:0,pendingAssets:pendingAssets.size,decodedAssets:decodedAssets.size,decodedBytes:decodedBytes,assetUses:assetUses,
    duckCount:duckCount,droppedCues:droppedCues,droppedCatchups:droppedCatchups,cueCounts:Object.assign({},cueCounts),failures:failures.slice(),busLevels:Object.assign({},busLevels),
    limits:{voices:MAX_VOICES,musicVoices:MAX_MUSIC_VOICES,cueVoices:MAX_CUE_VOICES,eventsPerTick:MAX_EVENTS_PER_TICK,buses:5,musicBuses:MAX_MUSIC_BUSES,transitions:MAX_TRANSITIONS,pendingAssets:MAX_PENDING,decodedBytes:MAX_DECODED_BYTES,failures:MAX_FAILURES}
  };}

  var API={
    CUES:CUES,BUS_DEFAULTS:BUS_DEFAULTS,normalizeManifest:normalizeManifest,resolveAudioState:resolveAudioState,surfaceForTile:surfaceForTile,
    init:init,unlock:unlock,setSnapshot:setSnapshot,setMusicScene:setMusicScene,cue:cue,setMuted:setMuted,setBusGain:setBusGain,cancelGroup:cancelGroup,
    suspend:suspend,resume:resume,reset:reset,getDiagnostics:getDiagnostics,loadManifest:loadManifest
  };

  if(typeof document!=="undefined")document.addEventListener("visibilitychange",function(){if(document.hidden)suspend();else resume();});
  if(typeof window!=="undefined"){window.addEventListener("pagehide",suspend);window.DatamonAudio=API;}
})();
