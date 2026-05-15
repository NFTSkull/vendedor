import Link from "next/link";

const styles = {
  main: {
    maxWidth: "40rem",
    margin: "0 auto",
    padding: "2rem 1.25rem 3rem",
    fontFamily: "system-ui, sans-serif",
    lineHeight: 1.6,
    color: "#1a1a1a",
  },
  h1: {
    fontSize: "1.75rem",
    fontWeight: 700,
    marginBottom: "0.25rem",
  },
  meta: { fontSize: "0.9rem", color: "#555", marginBottom: "1.75rem" },
  h2: {
    fontSize: "1.1rem",
    fontWeight: 600,
    marginTop: "1.5rem",
    marginBottom: "0.5rem",
  },
  p: { margin: "0 0 0.75rem" },
  ul: { margin: "0 0 0.75rem", paddingLeft: "1.25rem" },
  back: { marginTop: "2rem", fontSize: "0.95rem" },
} as const;

export default function PrivacidadPage() {
  return (
    <main style={styles.main}>
      <h1 style={styles.h1}>Política de privacidad</h1>
      <p style={styles.meta}>
        Última actualización: 15 de mayo de 2026
      </p>

      <p style={styles.p}>
        En Mejoravit nos importa la protección de tus datos personales. Esta
        política describe de forma clara qué información recopilamos, para qué
        la usamos y cuáles son tus derechos.
      </p>

      <h2 style={styles.h2}>1. Datos que recopilamos</h2>
      <p style={styles.p}>Podemos recopilar y tratar los siguientes datos:</p>
      <ul style={styles.ul}>
        <li>Tu nombre completo</li>
        <li>Tu Número de Seguro Social (NSS)</li>
        <li>Tu número de teléfono asociado a WhatsApp</li>
      </ul>

      <h2 style={styles.h2}>2. Finalidad del tratamiento</h2>
      <p style={styles.p}>
        Utilizamos estos datos exclusivamente para orientarte y realizar
        actividades de{" "}
        <strong>precalificación vinculadas a crédito Infonavit / Mejoravit</strong>
        , de acuerdo con el servicio que solicitas al contactarnos.
      </p>

      <h2 style={styles.h2}>3. Compartición con terceros</h2>
      <p style={styles.p}>
        <strong>No vendemos ni compartimos tus datos con terceros</strong>{" "}
        con fines comerciales ajenos al servicio. Las comunicaciones se limitan
        a lo necesario para la consulta o trámite: podemos compartir la
        información estrictamente requerida con{" "}
        <strong>Infonavit</strong> (u organismos vinculados al esquema) cuando
        sea indispensable para la validación o seguimiento de tu solicitud.
      </p>

      <h2 style={styles.h2}>4. Conservación y eliminación</h2>
      <p style={styles.p}>
        Conservamos los datos solo el tiempo razonable para cumplir la finalidad
        descrita y las obligaciones legales aplicables. Puedes solicitar el
        acceso, rectificación o la eliminación de tus datos personales según
        corresponda.
      </p>

      <h2 style={styles.h2}>5. Cómo contactarnos</h2>
      <p style={styles.p}>
        Para ejercer tus derechos o solicitar la eliminación de tus datos,
        contáctanos por el{" "}
        <strong>mismo canal de WhatsApp oficial</strong> con el que iniciaste la
        conversación, o por el correo electrónico de contacto que te hayamos
        indicado en ese canal. Responderemos en un plazo razonable.
      </p>

      <p style={styles.p}>
        Si tienes dudas sobre esta política, puedes escribirnos por esos mismos
        medios.
      </p>

      <p style={styles.back}>
        <Link href="/">← Volver al inicio</Link>
      </p>
    </main>
  );
}
