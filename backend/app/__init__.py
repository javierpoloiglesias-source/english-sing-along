"""English Sing Along - servidor local."""
__version__ = "1.1.0"

# Usa el almacén de certificados del sistema (Windows) para HTTPS. Necesario
# cuando un antivirus (p. ej. Avast Web Shield) inspecciona HTTPS con su propio
# certificado raíz: Windows confía en él pero la lista de `certifi` no.
# Las comprobaciones de certificados siguen activas.
try:
    import truststore

    truststore.inject_into_ssl()
except Exception:  # noqa: BLE001
    pass
