// Il Finder può avviare l'app da qualunque directory. Lo script sta accanto al bundle.
#import <AppKit/AppKit.h>

int main(void) {
    @autoreleasepool {
        NSURL *project = NSBundle.mainBundle.bundleURL.URLByDeletingLastPathComponent;
        NSURL *script = [project URLByAppendingPathComponent:@"avvia-app.sh"];
        NSTask *task = [NSTask new];
        task.currentDirectoryURL = project;
        task.executableURL = script;
        NSFileHandle *null = NSFileHandle.fileHandleWithNullDevice;
        task.standardInput = null;
        task.standardOutput = null;
        task.standardError = null;

        NSError *error = nil;
        if ([task launchAndReturnError:&error]) return 0;

        [NSApplication sharedApplication];
        NSAlert *alert = [NSAlert new];
        alert.messageText = @"O.S.C.A.R. non riesce ad avviarsi";
        alert.informativeText = [NSString stringWithFormat:@"Script di avvio: %@\n\n%@", script.path, error.localizedDescription];
        [alert runModal];
        return 1;
    }
}
