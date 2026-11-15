// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

//! Network policy for the native license client: proxy discovery, trust roots
//! and actionable transport error codes.
//!
//! On Windows the license client must behave like the rest of the system on a
//! corporate network: trust the Windows certificate store (TLS-inspecting
//! proxies install their root there) and use the WinINet/WinHTTP proxy the user
//! or Group Policy configured, including WPAD and PAC scripts. macOS keeps the
//! bundled-root, direct-connection client it has always used.

use std::error::Error as StdError;
use std::sync::Arc;

// Proxy selection runs only on Windows; the policy is compiled for host
// tests too, so it stays covered on every platform.
#[cfg(any(target_os = "windows", test))]
use proxy_policy::*;

#[cfg(any(target_os = "windows", test))]
mod proxy_policy {
    /// Per-user proxy settings, reduced to plain data so the selection policy is
    /// testable on every platform.
    #[derive(Debug, Default, Clone, PartialEq, Eq)]
    pub(super) struct SystemProxySettings {
        /// WPAD/PAC result for the request URL: `Some("")` means the script chose
        /// DIRECT, `None` means auto-proxy was off or failed.
        pub(super) auto_proxy: Option<String>,
        /// WinINet static proxy, `host:port` or `http=a:80;https=b:443`.
        pub(super) static_proxy: Option<String>,
        /// WinINet bypass list, e.g. `*.corp.example;<local>`.
        pub(super) bypass: Option<String>,
    }

    /// Explicit proxy environment variables; these override system settings.
    #[derive(Debug, Default, Clone, PartialEq, Eq)]
    pub(super) struct ProxyEnv {
        pub(super) https_proxy: Option<String>,
        pub(super) all_proxy: Option<String>,
        pub(super) no_proxy: Option<String>,
    }

    impl ProxyEnv {
        #[cfg(target_os = "windows")]
        pub(super) fn from_process() -> Self {
            let read = |names: &[&str]| {
                names
                    .iter()
                    .filter_map(|name| std::env::var(name).ok())
                    .map(|value| value.trim().to_string())
                    .find(|value| !value.is_empty())
            };
            Self {
                https_proxy: read(&["HTTPS_PROXY", "https_proxy"]),
                all_proxy: read(&["ALL_PROXY", "all_proxy"]),
                no_proxy: read(&["NO_PROXY", "no_proxy"]),
            }
        }
    }

    /// Chooses the HTTP proxy (as `http://host:port`) for an HTTPS request to
    /// `host`, or `None` for a direct connection.
    pub(super) fn select_proxy(
        env: &ProxyEnv,
        system: &SystemProxySettings,
        host: &str,
    ) -> Option<String> {
        let host = host.trim().trim_end_matches('.').to_ascii_lowercase();
        if env
            .no_proxy
            .as_deref()
            .is_some_and(|list| no_proxy_matches(list, &host))
        {
            return None;
        }
        if let Some(explicit) = env
            .https_proxy
            .as_deref()
            .or(env.all_proxy.as_deref())
            .and_then(normalize_proxy_entry)
        {
            return Some(explicit);
        }
        if let Some(auto) = system.auto_proxy.as_deref() {
            // A PAC/WPAD answer is authoritative, including an explicit DIRECT.
            return auto
                .split(|c: char| c == ';' || c.is_whitespace())
                .find_map(normalize_proxy_entry);
        }
        if system
            .bypass
            .as_deref()
            .is_some_and(|list| bypass_matches(list, &host))
        {
            return None;
        }
        system
            .static_proxy
            .as_deref()
            .and_then(static_proxy_for_https)
    }

    /// WinINet static proxy strings are either one `host:port` for every scheme
    /// or `scheme=host:port` pairs. HTTPS uses the `https=` pair, or the
    /// scheme-less entry; an `http=`-only list leaves HTTPS direct, as in Windows.
    pub(super) fn static_proxy_for_https(value: &str) -> Option<String> {
        let entries: Vec<&str> = value
            .split(|c: char| c == ';' || c.is_whitespace())
            .map(str::trim)
            .filter(|entry| !entry.is_empty())
            .collect();
        let scheme_entry = |scheme: &str| {
            entries.iter().find_map(|entry| {
                let (key, proxy) = entry.split_once('=')?;
                key.trim()
                    .eq_ignore_ascii_case(scheme)
                    .then(|| proxy.trim())
            })
        };
        if let Some(proxy) = scheme_entry("https") {
            return normalize_proxy_entry(proxy);
        }
        entries
            .iter()
            .find(|entry| !entry.contains('='))
            .and_then(|entry| normalize_proxy_entry(entry))
    }

    /// Normalizes one proxy entry to `http://host:port`. SOCKS and HTTPS-to-proxy
    /// entries are not supported by the license client and are skipped.
    pub(super) fn normalize_proxy_entry(entry: &str) -> Option<String> {
        let entry = entry.trim();
        let entry = entry
            .strip_prefix("PROXY ")
            .or_else(|| entry.strip_prefix("proxy "))
            .unwrap_or(entry)
            .trim();
        if entry.is_empty() || entry.eq_ignore_ascii_case("DIRECT") {
            return None;
        }
        let (scheme, rest) = match entry.split_once("://") {
            Some((scheme, rest)) => (scheme.to_ascii_lowercase(), rest),
            None => ("http".to_string(), entry),
        };
        if scheme != "http" {
            return None;
        }
        let authority = rest.trim_end_matches('/');
        if authority.is_empty() || authority.contains('/') {
            return None;
        }
        Some(format!("http://{authority}"))
    }

    /// curl-style `NO_PROXY`: `*`, exact hosts, or domain suffixes.
    pub(super) fn no_proxy_matches(list: &str, host: &str) -> bool {
        list.split(',').map(str::trim).any(|pattern| {
            let pattern = pattern
                .trim_start_matches("*.")
                .trim_start_matches('.')
                .to_ascii_lowercase();
            if pattern.is_empty() {
                return false;
            }
            pattern == "*" || host == pattern || host.ends_with(&format!(".{pattern}"))
        })
    }

    /// WinINet `ProxyOverride`: `;`-separated globs, optional scheme/port, and
    /// `<local>` for dotless intranet names.
    pub(super) fn bypass_matches(list: &str, host: &str) -> bool {
        list.split(|c: char| c == ';' || c == ',' || c.is_whitespace())
            .map(str::trim)
            .filter(|pattern| !pattern.is_empty())
            .any(|pattern| {
                if pattern.eq_ignore_ascii_case("<local>") {
                    return !host.contains('.');
                }
                let pattern = pattern.split_once("://").map_or(pattern, |(_, rest)| rest);
                let pattern = match pattern.rsplit_once(':') {
                    Some((name, port)) if port.bytes().all(|b| b.is_ascii_digit()) => name,
                    _ => pattern,
                };
                glob_matches(&pattern.to_ascii_lowercase(), host)
            })
    }

    pub(super) fn glob_matches(pattern: &str, text: &str) -> bool {
        let (pattern, text) = (pattern.as_bytes(), text.as_bytes());
        let (mut p, mut t) = (0, 0);
        let mut star: Option<(usize, usize)> = None;
        while t < text.len() {
            if p < pattern.len() && pattern[p] == b'*' {
                star = Some((p, t));
                p += 1;
            } else if p < pattern.len() && pattern[p] == text[t] {
                p += 1;
                t += 1;
            } else if let Some((star_p, star_t)) = star {
                p = star_p + 1;
                t = star_t + 1;
                star = Some((star_p, star_t + 1));
            } else {
                return false;
            }
        }
        pattern[p..].iter().all(|&byte| byte == b'*')
    }
}

/// The proxy for a license-server URL. Windows resolves the user's WinHTTP
/// settings (env override, WPAD/PAC, static proxy and bypass list); other
/// platforms keep their existing direct connection.
pub(crate) fn license_proxy(url: &str) -> Option<String> {
    #[cfg(target_os = "windows")]
    {
        let parsed = tauri::Url::parse(url).ok()?;
        let host = parsed.host_str()?;
        select_proxy(
            &ProxyEnv::from_process(),
            &windows_proxy::system_proxy_settings(url),
            host,
        )
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = url;
        None
    }
}

/// TLS configuration for the license client. Windows verifies with the
/// system certificate store (CryptoAPI chain building, enterprise roots and
/// on-demand root updates); `None` keeps ureq's bundled Mozilla roots.
pub(crate) fn tls_config() -> Option<Arc<rustls::ClientConfig>> {
    #[cfg(target_os = "windows")]
    {
        static CONFIG: std::sync::OnceLock<Option<Arc<rustls::ClientConfig>>> =
            std::sync::OnceLock::new();
        CONFIG
            .get_or_init(|| match platform_tls_config() {
                Ok(config) => Some(Arc::new(config)),
                Err(error) => {
                    log::warn!("license client falls back to bundled TLS roots: {error}");
                    None
                }
            })
            .clone()
    }
    #[cfg(not(target_os = "windows"))]
    {
        None
    }
}

#[cfg(target_os = "windows")]
fn platform_tls_config() -> Result<rustls::ClientConfig, rustls::Error> {
    use rustls_platform_verifier::BuilderVerifierExt;
    let provider = Arc::new(rustls::crypto::ring::default_provider());
    Ok(rustls::ClientConfig::builder_with_provider(provider)
        .with_safe_default_protocol_versions()?
        .with_platform_verifier()?
        .with_no_client_auth())
}

/// Maps a transport failure to a stable code the UI turns into an actionable,
/// localized message.
pub(crate) fn transport_error_code(error: &ureq::Transport) -> &'static str {
    transport_code(error.kind(), error.source())
}

fn transport_code(
    kind: ureq::ErrorKind,
    source: Option<&(dyn StdError + 'static)>,
) -> &'static str {
    match kind {
        ureq::ErrorKind::ProxyUnauthorized => "license_proxy_auth_required",
        ureq::ErrorKind::ProxyConnect | ureq::ErrorKind::InvalidProxyUrl => {
            "license_proxy_unavailable"
        }
        _ => match tls_failure(source) {
            Some(code) => code,
            None => "license_server_unavailable",
        },
    }
}

fn tls_failure(mut current: Option<&(dyn StdError + 'static)>) -> Option<&'static str> {
    while let Some(error) = current {
        let rustls_error = error.downcast_ref::<rustls::Error>().or_else(|| {
            // io::Error::source() skips its payload; inspect the payload too.
            error
                .downcast_ref::<std::io::Error>()
                .and_then(|io| io.get_ref())
                .and_then(|inner| inner.downcast_ref::<rustls::Error>())
        });
        if let Some(rustls_error) = rustls_error {
            return Some(match rustls_error {
                rustls::Error::InvalidCertificate(
                    rustls::CertificateError::Expired
                    | rustls::CertificateError::ExpiredContext { .. }
                    | rustls::CertificateError::NotValidYet
                    | rustls::CertificateError::NotValidYetContext { .. },
                ) => "license_clock_invalid",
                _ => "license_tls_untrusted",
            });
        }
        current = error.source();
    }
    None
}

#[cfg(target_os = "windows")]
mod windows_proxy {
    use super::SystemProxySettings;
    use windows::core::{w, HSTRING, PCWSTR, PWSTR};
    use windows::Win32::Foundation::{GlobalFree, HGLOBAL};
    use windows::Win32::Networking::WinHttp::{
        WinHttpCloseHandle, WinHttpGetIEProxyConfigForCurrentUser, WinHttpGetProxyForUrl,
        WinHttpOpen, WINHTTP_ACCESS_TYPE_NAMED_PROXY, WINHTTP_ACCESS_TYPE_NO_PROXY,
        WINHTTP_AUTOPROXY_AUTO_DETECT, WINHTTP_AUTOPROXY_CONFIG_URL, WINHTTP_AUTOPROXY_OPTIONS,
        WINHTTP_AUTO_DETECT_TYPE_DHCP, WINHTTP_AUTO_DETECT_TYPE_DNS_A,
        WINHTTP_CURRENT_USER_IE_PROXY_CONFIG, WINHTTP_PROXY_INFO,
    };

    /// Reads the current user's Internet Options proxy and evaluates WPAD/PAC
    /// for `url` the way WinINet does.
    pub(super) fn system_proxy_settings(url: &str) -> SystemProxySettings {
        let mut ie = WINHTTP_CURRENT_USER_IE_PROXY_CONFIG::default();
        // SAFETY: `ie` is a valid out-pointer; returned strings are owned by
        // the caller and released with GlobalFree in `take_wide`.
        let read = unsafe { WinHttpGetIEProxyConfigForCurrentUser(&mut ie) };
        let (auto_detect, pac_url, static_proxy, bypass) = match read {
            // SAFETY: on success each non-null field is a GlobalAlloc'd string.
            Ok(()) => unsafe {
                (
                    ie.fAutoDetect.as_bool(),
                    take_wide(ie.lpszAutoConfigUrl),
                    take_wide(ie.lpszProxy),
                    take_wide(ie.lpszProxyBypass),
                )
            },
            // No per-user settings exist: Windows' default is auto-detect.
            Err(_) => (true, None, None, None),
        };
        let auto_proxy = if auto_detect || pac_url.is_some() {
            auto_proxy_for_url(url, auto_detect, pac_url.as_deref())
        } else {
            None
        };
        SystemProxySettings {
            auto_proxy,
            static_proxy,
            bypass,
        }
    }

    fn auto_proxy_for_url(url: &str, auto_detect: bool, pac_url: Option<&str>) -> Option<String> {
        // SAFETY: plain session creation; the handle is closed below.
        let session = unsafe {
            WinHttpOpen(
                w!("Aries-License"),
                WINHTTP_ACCESS_TYPE_NO_PROXY,
                PCWSTR::null(),
                PCWSTR::null(),
                0,
            )
        };
        if session.is_null() {
            return None;
        }
        let pac = pac_url.map(HSTRING::from);
        let target = HSTRING::from(url);
        let mut options = WINHTTP_AUTOPROXY_OPTIONS::default();
        if auto_detect {
            options.dwFlags |= WINHTTP_AUTOPROXY_AUTO_DETECT;
            options.dwAutoDetectFlags =
                WINHTTP_AUTO_DETECT_TYPE_DHCP | WINHTTP_AUTO_DETECT_TYPE_DNS_A;
        }
        if let Some(pac) = pac.as_ref() {
            options.dwFlags |= WINHTTP_AUTOPROXY_CONFIG_URL;
            options.lpszAutoConfigUrl = PCWSTR(pac.as_ptr());
        }
        options.fAutoLogonIfChallenged = true.into();
        let mut info = WINHTTP_PROXY_INFO::default();
        // SAFETY: all pointers outlive the call; `info` strings are released
        // with GlobalFree in `take_wide`.
        let result = unsafe {
            WinHttpGetProxyForUrl(session, PCWSTR(target.as_ptr()), &mut options, &mut info)
        };
        // SAFETY: `session` came from WinHttpOpen above.
        let _ = unsafe { WinHttpCloseHandle(session) };
        result.ok()?;
        // SAFETY: on success the fields are GlobalAlloc'd strings or null.
        let (proxy, _bypass) =
            unsafe { (take_wide(info.lpszProxy), take_wide(info.lpszProxyBypass)) };
        if info.dwAccessType == WINHTTP_ACCESS_TYPE_NAMED_PROXY {
            Some(proxy.unwrap_or_default())
        } else {
            Some(String::new())
        }
    }

    /// Copies and frees a WinHTTP-allocated wide string.
    unsafe fn take_wide(value: PWSTR) -> Option<String> {
        if value.is_null() {
            return None;
        }
        // SAFETY: caller guarantees a valid NUL-terminated GlobalAlloc'd string.
        let text = unsafe { value.to_string() }.ok();
        // SAFETY: WinHTTP documents these buffers as GlobalFree-owned.
        let _ = unsafe { GlobalFree(Some(HGLOBAL(value.0.cast()))) };
        text.map(|text| text.trim().to_string())
            .filter(|text| !text.is_empty())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const HOST: &str = "license.example.test";

    fn system(
        auto: Option<&str>,
        fixed: Option<&str>,
        bypass: Option<&str>,
    ) -> SystemProxySettings {
        SystemProxySettings {
            auto_proxy: auto.map(str::to_string),
            static_proxy: fixed.map(str::to_string),
            bypass: bypass.map(str::to_string),
        }
    }

    #[test]
    fn direct_without_any_proxy_configuration() {
        assert_eq!(
            select_proxy(&ProxyEnv::default(), &SystemProxySettings::default(), HOST),
            None
        );
    }

    #[test]
    fn static_winineet_proxy_forms() {
        let env = ProxyEnv::default();
        assert_eq!(
            select_proxy(&env, &system(None, Some("proxy.corp:8080"), None), HOST),
            Some("http://proxy.corp:8080".to_string())
        );
        assert_eq!(
            select_proxy(
                &env,
                &system(None, Some("http=web:80;https=secure:8443;ftp=f:21"), None),
                HOST
            ),
            Some("http://secure:8443".to_string())
        );
        // An http-only list does not proxy HTTPS in Windows either.
        assert_eq!(
            select_proxy(&env, &system(None, Some("http=web:80"), None), HOST),
            None
        );
        // SOCKS-only configuration is unsupported: connect directly.
        assert_eq!(
            select_proxy(&env, &system(None, Some("socks=s:1080"), None), HOST),
            None
        );
    }

    #[test]
    fn bypass_list_skips_the_static_proxy() {
        let env = ProxyEnv::default();
        for bypass in [
            "*.example.test",
            "license.*;<local>",
            "https://*.test:443",
            "LICENSE.EXAMPLE.TEST",
        ] {
            assert_eq!(
                select_proxy(&env, &system(None, Some("proxy:8080"), Some(bypass)), HOST),
                None,
                "{bypass}"
            );
        }
        assert_eq!(
            select_proxy(
                &env,
                &system(None, Some("proxy:8080"), Some("<local>;*.corp")),
                HOST
            ),
            Some("http://proxy:8080".to_string())
        );
        assert!(bypass_matches("<local>", "intranet"));
    }

    #[test]
    fn pac_and_wpad_answers_win_over_static_settings() {
        let env = ProxyEnv::default();
        assert_eq!(
            select_proxy(
                &env,
                &system(
                    Some("pac-proxy:3128; backup:3128"),
                    Some("proxy:8080"),
                    None
                ),
                HOST
            ),
            Some("http://pac-proxy:3128".to_string())
        );
        // PAC said DIRECT: do not fall back to the static proxy.
        assert_eq!(
            select_proxy(&env, &system(Some(""), Some("proxy:8080"), None), HOST),
            None
        );
    }

    #[test]
    fn environment_overrides_system_settings() {
        let env = ProxyEnv {
            https_proxy: Some("http://env-proxy:9000/".to_string()),
            ..ProxyEnv::default()
        };
        assert_eq!(
            select_proxy(&env, &system(Some("pac:1"), Some("proxy:8080"), None), HOST),
            Some("http://env-proxy:9000".to_string())
        );
        let excluded = ProxyEnv {
            no_proxy: Some("localhost, .example.test".to_string()),
            ..env.clone()
        };
        assert_eq!(
            select_proxy(&excluded, &system(None, Some("proxy:8080"), None), HOST),
            None
        );
        let socks = ProxyEnv {
            https_proxy: Some("socks5://s:1080".to_string()),
            ..ProxyEnv::default()
        };
        assert_eq!(
            select_proxy(&socks, &SystemProxySettings::default(), HOST),
            None
        );
    }

    #[test]
    fn selected_proxies_parse_as_ureq_proxies() {
        for entry in [
            "proxy.corp:8080",
            "http://user:pass@proxy:3128",
            "10.0.0.1:80",
        ] {
            let normalized = normalize_proxy_entry(entry).expect(entry);
            assert!(ureq::Proxy::new(&normalized).is_ok(), "{normalized}");
            assert!(tauri::Url::parse(&normalized).is_ok(), "{normalized}");
        }
    }

    fn io_wrapped(error: rustls::Error) -> ureq::Transport {
        match ureq::Error::from(std::io::Error::new(std::io::ErrorKind::InvalidData, error)) {
            ureq::Error::Transport(transport) => transport,
            ureq::Error::Status(..) => unreachable!(),
        }
    }

    #[test]
    fn tls_interception_and_clock_failures_are_distinguished() {
        let untrusted = io_wrapped(rustls::Error::InvalidCertificate(
            rustls::CertificateError::UnknownIssuer,
        ));
        assert_eq!(transport_error_code(&untrusted), "license_tls_untrusted");
        let expired = io_wrapped(rustls::Error::InvalidCertificate(
            rustls::CertificateError::Expired,
        ));
        assert_eq!(transport_error_code(&expired), "license_clock_invalid");
        let offline = match ureq::Error::from(std::io::Error::new(
            std::io::ErrorKind::ConnectionRefused,
            "refused",
        )) {
            ureq::Error::Transport(transport) => transport,
            ureq::Error::Status(..) => unreachable!(),
        };
        assert_eq!(transport_error_code(&offline), "license_server_unavailable");
    }

    #[test]
    fn proxy_failures_have_their_own_codes() {
        assert_eq!(
            transport_code(ureq::ErrorKind::ProxyUnauthorized, None),
            "license_proxy_auth_required"
        );
        assert_eq!(
            transport_code(ureq::ErrorKind::ProxyConnect, None),
            "license_proxy_unavailable"
        );
        assert_eq!(
            transport_code(ureq::ErrorKind::Dns, None),
            "license_server_unavailable"
        );
    }
}
