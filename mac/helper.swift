// STEM — aiutante nativo per il controllo del Mac: mouse, tastiera, app, permessi.
// Lo compila mac-mcp.mjs con /usr/bin/swiftc in runtime/stem-mac. Ogni comando stampa una riga JSON e esce.
// Coordinate sempre in punti dello schermo (origine in alto a sinistra dello schermo principale).
import AppKit
import ApplicationServices
import Carbon

// MARK: - Uscita

func out(_ o: [String: Any]) -> Never {
  var o = o
  if o["ok"] == nil { o["ok"] = true }
  let d = (try? JSONSerialization.data(withJSONObject: o, options: [.sortedKeys])) ?? Data("{\"ok\":false}".utf8)
  FileHandle.standardOutput.write(d)
  FileHandle.standardOutput.write(Data("\n".utf8))
  exit(0)
}

func fail(_ msg: String, _ extra: [String: Any] = [:]) -> Never {
  var o = extra
  o["ok"] = false
  o["errore"] = msg
  out(o)
}

func pause(_ s: Double) { RunLoop.current.run(until: Date().addingTimeInterval(s)) }

// MARK: - Chi risponde dei permessi (l'app da autorizzare nelle Impostazioni)

func pidPath(_ pid: pid_t) -> String? {
  var buf = [CChar](repeating: 0, count: 4096)
  return proc_pidpath(pid, &buf, UInt32(buf.count)) > 0 ? String(cString: buf) : nil
}

func parentPid(_ pid: pid_t) -> pid_t {
  var info = proc_bsdinfo()
  let n = proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, &info, Int32(MemoryLayout<proc_bsdinfo>.size))
  return n > 0 ? pid_t(info.pbi_ppid) : 0
}

// Il pacchetto .app più interno che contiene l'eseguibile
func appBundle(_ exe: String) -> String? {
  guard let r = exe.range(of: ".app/", options: .backwards) else { return nil }
  return String(exe[..<r.lowerBound]) + ".app"
}

func responsible() -> [String: Any] {
  typealias Fn = @convention(c) (pid_t) -> pid_t
  var pid: pid_t = 0
  if let sym = dlsym(UnsafeMutableRawPointer(bitPattern: -2), "responsibility_get_pid_responsible_for_pid") { // RTLD_DEFAULT
    pid = unsafeBitCast(sym, to: Fn.self)(getpid())
  }
  // Senza la funzione privata: il primo antenato che sta dentro un .app
  if pid <= 0 || pid == getpid() || appBundle(pidPath(pid) ?? "") == nil {
    var p = parentPid(getpid())
    while p > 1 {
      if appBundle(pidPath(p) ?? "") != nil { pid = p; break }
      p = parentPid(p)
    }
  }
  guard pid > 0, let exe = pidPath(pid) else { return [:] }
  let bundle = appBundle(exe)
  var name = NSRunningApplication(processIdentifier: pid)?.localizedName
  if name == nil, let b = bundle { name = FileManager.default.displayName(atPath: b) }
  if let n = name, n.hasSuffix(".app") { name = String(n.dropLast(4)) }
  return ["app": name ?? (exe as NSString).lastPathComponent, "percorso": bundle ?? exe]
}

func needAccessibility() {
  if !AXIsProcessTrusted() {
    var o = responsible()
    o["permesso"] = "accessibilita"
    fail("manca il permesso di Accessibilità", o)
  }
}

// MARK: - App in primo piano

func frontInfo() -> [String: Any] {
  guard let a = NSWorkspace.shared.frontmostApplication else { return [:] }
  return ["primo_piano": a.localizedName ?? "", "primo_piano_bundle": a.bundleIdentifier ?? ""]
}

// --solo-se <bundle>: niente input se in primo piano c'è un'altra app.
// --vieta <b1,b2>: niente input nelle app escluse (terminali, password).
func checkFront(_ args: inout [String]) {
  var only: String?
  var deny: [String] = []
  var rest: [String] = []
  var i = 0
  while i < args.count {
    if args[i] == "--solo-se", i + 1 < args.count { only = args[i + 1]; i += 2; continue }
    if args[i] == "--vieta", i + 1 < args.count { deny = args[i + 1].split(separator: ",").map(String.init); i += 2; continue }
    rest.append(args[i]); i += 1
  }
  args = rest
  let front = NSWorkspace.shared.frontmostApplication
  let fb = front?.bundleIdentifier ?? ""
  if let o = only, fb.lowercased() != o.lowercased() {
    var e = frontInfo(); e["rifiuto"] = "primo_piano"
    fail("in primo piano c'è \(front?.localizedName ?? "un'altra app"), non \(o)", e)
  }
  if deny.contains(where: { $0.lowercased() == fb.lowercased() }) {
    var e = frontInfo(); e["rifiuto"] = "app_vietata"
    fail("non scrivo in \(front?.localizedName ?? fb)", e)
  }
}

// MARK: - Campo password

func axString(_ el: AXUIElement, _ attr: String) -> String? {
  var v: CFTypeRef?
  guard AXUIElementCopyAttributeValue(el, attr as CFString, &v) == .success else { return nil }
  return v as? String
}

func focusedElement() -> AXUIElement? {
  var v: CFTypeRef?
  if let app = NSWorkspace.shared.frontmostApplication {
    let a = AXUIElementCreateApplication(app.processIdentifier)
    AXUIElementSetMessagingTimeout(a, 1.0)
    // Chrome ed Electron espongono i campi delle pagine solo se l'accessibilità è accesa
    var cur: CFTypeRef?
    let on = AXUIElementCopyAttributeValue(a, "AXManualAccessibility" as CFString, &cur) == .success && (cur as? Bool) == true
    if !on, AXUIElementSetAttributeValue(a, "AXManualAccessibility" as CFString, kCFBooleanTrue) == .success { pause(0.25) }
    if AXUIElementCopyAttributeValue(a, kAXFocusedUIElementAttribute as CFString, &v) == .success, let v {
      return (v as! AXUIElement)
    }
  }
  let sys = AXUIElementCreateSystemWide()
  AXUIElementSetMessagingTimeout(sys, 1.0)
  if AXUIElementCopyAttributeValue(sys, kAXFocusedUIElementAttribute as CFString, &v) == .success, let v {
    return (v as! AXUIElement)
  }
  return nil
}

// nil = si può scrivere; altrimenti il motivo del rifiuto
func secureReason() -> String? {
  if IsSecureEventInputEnabled() {
    var who = ""
    if let d = CGSessionCopyCurrentDictionary() as? [String: Any], let pid = d["kCGSSessionSecureInputPID"] as? Int,
       let n = NSRunningApplication(processIdentifier: pid_t(pid))?.localizedName {
      who = " (lo tiene acceso \(n))"
    }
    return "l'inserimento sicuro della tastiera è attivo\(who): di solito vuol dire che è selezionato un campo password"
  }
  if let el = focusedElement() {
    let role = axString(el, kAXRoleAttribute) ?? ""
    let sub = axString(el, kAXSubroleAttribute) ?? ""
    if role == "AXSecureTextField" || sub == "AXSecureTextField" { return "il campo selezionato è un campo password" }
  }
  return nil
}

func refuseIfSecure() {
  if let why = secureReason() {
    var e = frontInfo(); e["rifiuto"] = "password"
    fail(why, e)
  }
}

// MARK: - Mouse

let source = CGEventSource(stateID: .hidSystemState)

func mouse(_ type: CGEventType, _ p: CGPoint, _ b: CGMouseButton, clicks: Int64 = 1) {
  guard let e = CGEvent(mouseEventSource: source, mouseType: type, mouseCursorPosition: p, mouseButton: b) else { return }
  e.setIntegerValueField(.mouseEventClickState, value: clicks)
  e.post(tap: .cghidEventTap)
}

func point(_ a: [String], _ i: Int) -> CGPoint {
  guard a.count > i + 1, let x = Double(a[i]), let y = Double(a[i + 1]), x.isFinite, y.isFinite else { fail("coordinate non valide") }
  return CGPoint(x: x, y: y)
}

// MARK: - Tastiera

// Tasti con nome (codici fisici Apple, uguali su ogni disposizione)
let named: [String: CGKeyCode] = [
  "return": 36, "invio": 36, "enter": 36, "a_capo": 36,
  "tab": 48, "tabulazione": 48,
  "space": 49, "spazio": 49, "barra": 49,
  "delete": 51, "backspace": 51, "cancella": 51, "indietro": 51,
  "forwarddelete": 117, "canc": 117, "elimina": 117,
  "esc": 53, "escape": 53, "esci": 53,
  "up": 126, "su": 126, "freccia_su": 126, "↑": 126,
  "down": 125, "giu": 125, "giù": 125, "freccia_giu": 125, "freccia_giù": 125, "↓": 125,
  "left": 123, "sinistra": 123, "freccia_sinistra": 123, "←": 123,
  "right": 124, "destra": 124, "freccia_destra": 124, "→": 124,
  "home": 115, "inizio": 115, "end": 119, "fine": 119,
  "pageup": 116, "pagsu": 116, "pagina_su": 116, "pagedown": 121, "paggiu": 121, "pagina_giu": 121,
  "f1": 122, "f2": 120, "f3": 99, "f4": 118, "f5": 96, "f6": 97, "f7": 98, "f8": 100,
  "f9": 101, "f10": 109, "f11": 103, "f12": 111,
]
let arrows: Set<CGKeyCode> = [123, 124, 125, 126]

let modifiers: [String: (CGKeyCode, CGEventFlags)] = [
  "cmd": (55, .maskCommand), "command": (55, .maskCommand), "comando": (55, .maskCommand), "⌘": (55, .maskCommand), "mela": (55, .maskCommand),
  "shift": (56, .maskShift), "maiusc": (56, .maskShift), "maiuscolo": (56, .maskShift), "⇧": (56, .maskShift),
  "alt": (58, .maskAlternate), "option": (58, .maskAlternate), "opt": (58, .maskAlternate), "opzione": (58, .maskAlternate), "⌥": (58, .maskAlternate),
  "ctrl": (59, .maskControl), "control": (59, .maskControl), "controllo": (59, .maskControl), "⌃": (59, .maskControl),
  "fn": (63, .maskSecondaryFn),
]

// Disposizione americana: riserva se la disposizione attuale non si legge
let ansi: [Character: CGKeyCode] = [
  "a": 0, "s": 1, "d": 2, "f": 3, "h": 4, "g": 5, "z": 6, "x": 7, "c": 8, "v": 9, "b": 11, "q": 12, "w": 13, "e": 14,
  "r": 15, "y": 16, "t": 17, "1": 18, "2": 19, "3": 20, "4": 21, "6": 22, "5": 23, "=": 24, "9": 25, "7": 26, "-": 27,
  "8": 28, "0": 29, "]": 30, "o": 31, "u": 32, "[": 33, "i": 34, "p": 35, "l": 37, "j": 38, "'": 39, "k": 40, ";": 41,
  "\\": 42, ",": 43, "/": 44, "n": 45, "m": 46, ".": 47, "`": 50,
]

// Carattere → (tasto, serve maiuscolo) secondo la disposizione di tastiera attuale (es. italiana)
func layoutMap() -> [Character: (CGKeyCode, Bool)] {
  var map: [Character: (CGKeyCode, Bool)] = [:]
  var src = TISCopyCurrentKeyboardLayoutInputSource()?.takeRetainedValue()
  var raw = src.flatMap { TISGetInputSourceProperty($0, kTISPropertyUnicodeKeyLayoutData) }
  if raw == nil {
    src = TISCopyCurrentASCIICapableKeyboardLayoutInputSource()?.takeRetainedValue()
    raw = src.flatMap { TISGetInputSourceProperty($0, kTISPropertyUnicodeKeyLayoutData) }
  }
  guard let r = raw else { return map }
  let data = Unmanaged<CFData>.fromOpaque(r).takeUnretainedValue()
  guard let bytes = CFDataGetBytePtr(data) else { return map }
  let layout = UnsafeRawPointer(bytes).assumingMemoryBound(to: UCKeyboardLayout.self)
  let kb = UInt32(LMGetKbdType())
  let keypad = Set(65...92)
  for pass in 0..<2 { // prima la tastiera principale, poi il tastierino numerico
    for shift in [false, true] {
      for code in 0..<128 where keypad.contains(code) == (pass == 1) {
        var dead: UInt32 = 0
        var len = 0
        var chars = [UniChar](repeating: 0, count: 4)
        let mod: UInt32 = shift ? UInt32((shiftKey >> 8) & 0xFF) : 0
        let st = UCKeyTranslate(layout, UInt16(code), UInt16(kUCKeyActionDown), mod, kb, 0, &dead, 4, &len, &chars)
        guard st == noErr, dead == 0, len == 1, chars[0] >= 0x20, chars[0] != 0x7F,
              let s = String(utf16CodeUnits: chars, count: len).first else { continue }
        if map[s] == nil { map[s] = (CGKeyCode(code), shift) }
      }
    }
  }
  return map
}

func key(_ code: CGKeyCode, down: Bool, flags: CGEventFlags, text: String? = nil) {
  guard let e = CGEvent(keyboardEventSource: source, virtualKey: code, keyDown: down) else { return }
  var f = flags
  if arrows.contains(code) { f.insert([.maskNumericPad, .maskSecondaryFn]) } // come la tastiera vera
  e.flags = f
  if let t = text {
    let u = Array(t.utf16)
    e.keyboardSetUnicodeString(stringLength: u.count, unicodeString: u)
  }
  e.post(tap: .cghidEventTap)
}

// App che ha davvero il fuoco ora (AX, non il valore in cache di NSWorkspace)
func focusedPid() -> pid_t? {
  var app: CFTypeRef?
  guard AXUIElementCopyAttributeValue(AXUIElementCreateSystemWide(), kAXFocusedApplicationAttribute as CFString, &app) == .success,
        let a = app else { return nil }
  var pid: pid_t = 0
  return AXUIElementGetPid(a as! AXUIElement, &pid) == .success ? pid : nil
}

func typeText(_ text: String) {
  let map = layoutMap()
  let startPid = focusedPid()
  for (n, ch) in text.enumerated() {
    // Ogni 12 caratteri ricontrollo: se il fuoco è passato a un'altra app o a un campo password, smetto subito
    if n % 12 == 0 && n > 0 {
      refuseIfSecure()
      if let p = startPid, let now = focusedPid(), now != p { var e = frontInfo(); e["rifiuto"] = "primo_piano"; fail("il fuoco è passato a un'altra app: smetto di scrivere", e) }
    }
    switch ch {
    case "\n", "\r", "\r\n":
      key(36, down: true, flags: []); usleep(4000); key(36, down: false, flags: [])
    case "\t":
      key(48, down: true, flags: []); usleep(4000); key(48, down: false, flags: [])
    default:
      let s = String(ch)
      let (code, shift) = map[ch] ?? (0, false) // senza tasto: il carattere arriva come testo Unicode
      let f: CGEventFlags = shift ? .maskShift : []
      key(code, down: true, flags: f, text: s); usleep(4000); key(code, down: false, flags: f, text: s)
    }
    usleep(6000)
  }
}

// "cmd+shift+4", "return", "cmd++"
func parseCombo(_ combo: String) -> (CGKeyCode, CGEventFlags, [(CGKeyCode, CGEventFlags)], Bool) {
  var s = combo.trimmingCharacters(in: .whitespaces).lowercased()
  var parts: [String] = []
  if s.hasSuffix("++") { s.removeLast(2); parts = s.split(separator: "+").map { $0.trimmingCharacters(in: .whitespaces) } + ["+"] }
  else if s == "+" { parts = ["+"] }
  else { parts = s.split(separator: "+").map { $0.trimmingCharacters(in: .whitespaces) } }
  parts = parts.filter { !$0.isEmpty }
  guard let last = parts.last else { fail("combinazione vuota") }
  var flags: CGEventFlags = []
  var mods: [(CGKeyCode, CGEventFlags)] = []
  for m in parts.dropLast() {
    guard let mod = modifiers[m] else { fail("modificatore sconosciuto: \(m) (usa cmd, shift, alt, ctrl, fn)") }
    if !flags.contains(mod.1) { flags.insert(mod.1); mods.append(mod) }
  }
  if let c = named[last] ?? named[last.replacingOccurrences(of: " ", with: "_")] { return (c, flags, mods, false) }
  if last.count == 1, let ch = last.first {
    if let (c, sh) = layoutMap()[ch] {
      if sh && !flags.contains(.maskShift) { flags.insert(.maskShift); mods.append((56, .maskShift)) }
      return (c, flags, mods, true)
    }
    if let c = ansi[ch] { return (c, flags, mods, true) }
  }
  fail("tasto sconosciuto: \(last)")
}

// MARK: - App installate

func appPaths() -> [String] {
  let fm = FileManager.default
  let roots = ["/Applications", "/System/Applications", "/System/Applications/Utilities", NSHomeDirectory() + "/Applications"]
  var paths: [String] = []
  for r in roots {
    for e in (try? fm.contentsOfDirectory(atPath: r)) ?? [] where !e.hasPrefix(".") {
      let p = r + "/" + e
      if e.hasSuffix(".app") { paths.append(p); continue }
      var dir: ObjCBool = false
      guard !roots.contains(p), fm.fileExists(atPath: p, isDirectory: &dir), dir.boolValue else { continue }
      for e2 in (try? fm.contentsOfDirectory(atPath: p)) ?? [] where e2.hasSuffix(".app") { paths.append(p + "/" + e2) }
    }
  }
  paths.append("/System/Library/CoreServices/Finder.app")
  return paths
}

// Nome italiano dal pacchetto, anche se il processo non è localizzato
func italianName(_ b: Bundle) -> String? {
  if let p = b.path(forResource: "InfoPlist", ofType: "loctable"), let d = NSDictionary(contentsOfFile: p) as? [String: Any] {
    for lang in ["it", "it_IT", "Italian"] {
      if let t = d[lang] as? [String: Any], let n = (t["CFBundleDisplayName"] ?? t["CFBundleName"]) as? String { return n }
    }
  }
  for lang in ["it", "it_IT", "Italian"] {
    if let p = b.path(forResource: "InfoPlist", ofType: "strings", inDirectory: nil, forLocalization: lang),
       let d = NSDictionary(contentsOfFile: p) as? [String: Any],
       let n = (d["CFBundleDisplayName"] ?? d["CFBundleName"]) as? String { return n }
  }
  return nil
}

func installedApps() -> [[String: Any]] {
  let fm = FileManager.default
  var seen = Set<String>()
  var list: [[String: Any]] = []
  for p in appPaths() where !seen.contains(p) {
    seen.insert(p)
    let b = Bundle(path: p)
    let info = b?.infoDictionary ?? [:]
    let base = ((p as NSString).lastPathComponent as NSString).deletingPathExtension
    var display = fm.displayName(atPath: p)
    if display.hasSuffix(".app") { display = String(display.dropLast(4)) }
    var names: [String] = []
    for n in [b.flatMap(italianName), display, base, info["CFBundleDisplayName"] as? String, info["CFBundleName"] as? String] {
      if let n, !n.isEmpty, !names.contains(n) { names.append(n) }
    }
    list.append(["nome": names.first ?? base, "nomi": names, "percorso": p, "bundle": b?.bundleIdentifier ?? ""])
  }
  return list
}

// MARK: - Comandi

var args = Array(CommandLine.arguments.dropFirst())
guard let cmd = args.first else { fail("comando mancante") }
args.removeFirst()

switch cmd {
case "permessi":
  var o = responsible()
  o["accessibilita"] = AXIsProcessTrusted()
  o["schermo"] = CGPreflightScreenCaptureAccess()
  out(o)

case "chiedi": // mette l'app nell'elenco delle Impostazioni (va poi attivata a mano)
  if args.first == "schermo" { _ = CGRequestScreenCaptureAccess() }
  else { _ = AXIsProcessTrustedWithOptions([kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary) }
  out(responsible())

case "display":
  let id = CGMainDisplayID()
  let b = CGDisplayBounds(id)
  let px = CGDisplayCopyDisplayMode(id).map { Double($0.pixelWidth) } ?? Double(b.width) * 2
  out(["x": b.origin.x, "y": b.origin.y, "larghezza": b.width, "altezza": b.height, "scala": px / Double(b.width)])

case "schermi": // tutti i display attivi, in punti, coordinate globali (y verso il basso, origine nello schermo principale)
  var count: UInt32 = 0
  CGGetActiveDisplayList(0, nil, &count)
  var ids = [CGDirectDisplayID](repeating: 0, count: Int(count))
  CGGetActiveDisplayList(count, &ids, &count)
  let main = CGMainDisplayID()
  let list: [[String: Any]] = ids.prefix(Int(count)).map { id in
    let b = CGDisplayBounds(id)
    let px = CGDisplayCopyDisplayMode(id).map { Double($0.pixelWidth) } ?? Double(b.width)
    return ["x": b.origin.x, "y": b.origin.y, "larghezza": b.width, "altezza": b.height, "scala": px / Double(b.width), "principale": id == main]
  }
  out(["schermi": list])

case "finestra": // dove sta la finestra più in alto dell'app in primo piano (per fotografare lo schermo giusto)
  guard let app = NSWorkspace.shared.frontmostApplication else { out([:]) }
  let info = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []
  for w in info {
    guard (w[kCGWindowOwnerPID as String] as? Int32) == app.processIdentifier, (w[kCGWindowLayer as String] as? Int) == 0,
          let b = w[kCGWindowBounds as String] as? [String: Any],
          let x = b["X"] as? Double, let y = b["Y"] as? Double, let ww = b["Width"] as? Double, let hh = b["Height"] as? Double, ww > 40, hh > 40 else { continue }
    out(["app": app.localizedName ?? "", "x": x, "y": y, "larghezza": ww, "altezza": hh])
  }
  out(["app": app.localizedName ?? ""])

case "clic":
  needAccessibility()
  let p = point(args, 0)
  let right = args.count > 2 && args[2] == "destro"
  let double = args.count > 3 && args[3] == "2"
  let (down, up, btn): (CGEventType, CGEventType, CGMouseButton) = right ? (.rightMouseDown, .rightMouseUp, .right) : (.leftMouseDown, .leftMouseUp, .left)
  mouse(.mouseMoved, p, .left); usleep(40_000)
  mouse(down, p, btn, clicks: 1); usleep(30_000); mouse(up, p, btn, clicks: 1)
  if double { usleep(60_000); mouse(down, p, btn, clicks: 2); usleep(30_000); mouse(up, p, btn, clicks: 2) }
  pause(0.2)
  out(frontInfo())

case "muovi":
  needAccessibility()
  mouse(.mouseMoved, point(args, 0), .left)
  out([:])

case "trascina":
  needAccessibility()
  let a = point(args, 0), b = point(args, 2)
  mouse(.mouseMoved, a, .left); usleep(50_000)
  mouse(.leftMouseDown, a, .left); usleep(80_000)
  let steps = 30
  for i in 1...steps {
    let t = Double(i) / Double(steps)
    mouse(.leftMouseDragged, CGPoint(x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t), .left)
    usleep(12_000)
  }
  usleep(60_000)
  mouse(.leftMouseUp, b, .left)
  pause(0.15)
  out(frontInfo())

case "scorri": // dx, dy in righe: dy > 0 in giù, dx > 0 a destra
  needAccessibility()
  let p = point(args, 0)
  guard args.count > 3, var dx = Int(args[2]), var dy = Int(args[3]) else { fail("dx e dy mancanti") }
  dx = max(-200, min(200, dx)); dy = max(-200, min(200, dy))
  mouse(.mouseMoved, p, .left); usleep(40_000)
  while dx != 0 || dy != 0 { // a piccoli passi, come una rotella
    let sx = max(-5, min(5, dx)), sy = max(-5, min(5, dy))
    CGEvent(scrollWheelEvent2Source: source, units: .line, wheelCount: 2, wheel1: Int32(-sy), wheel2: Int32(-sx), wheel3: 0)?.post(tap: .cghidEventTap)
    dx -= sx; dy -= sy
    usleep(16_000)
  }
  out(frontInfo())

case "scrivi": // il testo arriva da stdin
  needAccessibility()
  checkFront(&args)
  refuseIfSecure()
  let text = String(decoding: FileHandle.standardInput.readDataToEndOfFile(), as: UTF8.self)
  guard !text.isEmpty else { fail("testo vuoto") }
  typeText(text)
  out(frontInfo())

case "tasti":
  needAccessibility()
  checkFront(&args)
  guard let combo = args.first else { fail("combinazione mancante") }
  let times = max(1, min(50, args.count > 1 ? Int(args[1]) ?? 1 : 1))
  let (code, flags, mods, printable) = parseCombo(combo)
  // Un carattere senza cmd/ctrl è scrivere; cmd+v incolla: niente dei due in un campo password
  let typing = printable && !flags.contains(.maskCommand) && !flags.contains(.maskControl)
  if typing || (flags.contains(.maskCommand) && code == (layoutMap()["v"]?.0 ?? 9)) { refuseIfSecure() }
  for _ in 0..<times {
    var f: CGEventFlags = [] // i modificatori si premono davvero, uno alla volta, poi il tasto
    for (c, m) in mods { f.insert(m); key(c, down: true, flags: f); usleep(8000) }
    key(code, down: true, flags: flags); usleep(20_000); key(code, down: false, flags: flags)
    for (c, m) in mods.reversed() { f.remove(m); usleep(8000); key(c, down: false, flags: f) }
    usleep(30_000)
  }
  pause(0.15)
  out(frontInfo())

case "app-aperte":
  let front = NSWorkspace.shared.frontmostApplication?.processIdentifier
  let apps = NSWorkspace.shared.runningApplications.filter { $0.activationPolicy == .regular }.map { a -> [String: Any] in
    ["nome": a.localizedName ?? "", "bundle": a.bundleIdentifier ?? "", "pid": Int(a.processIdentifier),
     "percorso": a.bundleURL?.path ?? "", "primo_piano": a.processIdentifier == front]
  }
  out(["app": apps])

case "app-installate":
  out(["app": installedApps()])

case "chiudi": // uscita gentile (come cmd+Q), mai forzata
  let pids = args.compactMap { Int32($0) }
  for p in pids { _ = NSRunningApplication(processIdentifier: p)?.terminate() }
  let deadline = Date().addingTimeInterval(4)
  var alive = pids
  while !alive.isEmpty && Date() < deadline {
    pause(0.1)
    alive = alive.filter { kill($0, 0) == 0 }
  }
  out(["chiuse": pids.filter { !alive.contains($0) }.map(Int.init), "ancora_aperte": alive.map(Int.init)])

default:
  fail("comando sconosciuto: \(cmd)")
}
