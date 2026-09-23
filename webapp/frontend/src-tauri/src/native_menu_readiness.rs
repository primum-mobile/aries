// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

/// Daemon health can precede native menu installation. Retain the installation
/// result so early and late IPC callers observe the same readiness boundary.
pub(crate) struct NativeMenuReadiness(tokio::sync::watch::Sender<Option<Result<(), String>>>);

impl Default for NativeMenuReadiness {
    fn default() -> Self {
        Self(tokio::sync::watch::channel(None).0)
    }
}

impl NativeMenuReadiness {
    pub(crate) fn begin(&self) {
        self.0.send_replace(None);
    }

    pub(crate) fn finish(&self, result: Result<(), String>) {
        self.0.send_replace(Some(result));
    }

    pub(crate) async fn wait(&self) -> Result<(), String> {
        let mut receiver = self.0.subscribe();
        loop {
            if let Some(result) = receiver.borrow_and_update().clone() {
                return result;
            }
            receiver
                .changed()
                .await
                .map_err(|error| error.to_string())?;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn native_menu_readiness_waits_for_installation_and_retains_completion() {
        tauri::async_runtime::block_on(async {
            let state = std::sync::Arc::new(NativeMenuReadiness::default());
            let early = state.clone();
            let mut waiting = tauri::async_runtime::spawn(async move { early.wait().await });
            assert!(
                tokio::time::timeout(std::time::Duration::from_millis(10), &mut waiting)
                    .await
                    .is_err()
            );
            state.finish(Ok(()));
            assert_eq!(waiting.await.unwrap(), Ok(()));
            assert_eq!(state.wait().await, Ok(()));
            state.begin();
            assert!(
                tokio::time::timeout(std::time::Duration::from_millis(10), state.wait())
                    .await
                    .is_err()
            );
            state.finish(Err("installation failed".into()));
            assert_eq!(state.wait().await, Err("installation failed".into()));
        });
    }
}
