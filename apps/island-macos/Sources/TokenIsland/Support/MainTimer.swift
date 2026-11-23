import Foundation

// MARK: - One-shot main runloop timer
//
// Used for the 120 ms hover-expand delay, the 400 ms collapse delay and the
// toast dismissal. `.common` runloop modes keep the timers firing while a menu
// is tracking; using a Timer also keeps the code plain AppKit main-thread code
// (no background dispatch).

final class MainTimer {
    private var timer: Timer?
    private let action: () -> Void

    init(interval: TimeInterval, action: @escaping () -> Void) {
        self.action = action
        let timer = Timer(timeInterval: interval, repeats: false) { [weak self] _ in
            self?.fire()
        }
        self.timer = timer
        RunLoop.main.add(timer, forMode: .common)
    }

    func cancel() {
        timer?.invalidate()
        timer = nil
    }

    private func fire() {
        timer = nil
        action()
    }

    deinit {
        timer?.invalidate()
    }
}
