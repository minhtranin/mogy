#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Redirect stdout/stderr to /dev/null to prevent WebView
    // escape sequences from polluting the terminal
    #[cfg(target_os = "linux")]
    {
        use std::fs::File;
        use std::os::unix::io::AsRawFd;

        if let Ok(devnull) = File::open("/dev/null") {
            let fd = devnull.as_raw_fd();
            unsafe {
                libc::dup2(fd, 1); // stdout
                libc::dup2(fd, 2); // stderr
            }
        }
    }

    mogy_lib::run();
}
