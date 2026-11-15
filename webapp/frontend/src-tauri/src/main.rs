// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    if std::env::args().any(|argument| argument == "--assert-licensed-build") {
        if let Err(error) = aries_lib::verify_licensed_build_contract() {
            eprintln!("licensed build verification failed: {error}");
            std::process::exit(2);
        }
        return;
    }
    if std::env::args().any(|argument| argument == "--assert-store-distribution") {
        if let Err(error) = aries_lib::verify_store_distribution_contract() {
            eprintln!("store distribution verification failed: {error}");
            std::process::exit(3);
        }
        return;
    }
    aries_lib::run();
}
