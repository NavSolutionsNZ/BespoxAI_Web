import nodemailer from 'nodemailer'

const transporter = nodemailer.createTransport({
  host:   process.env.SMTP_HOST ?? 'mail.spacemail.com',
  port:   Number(process.env.SMTP_PORT ?? 465),
  secure: Number(process.env.SMTP_PORT ?? 465) === 465,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
})

const FROM = `BespoxAI <${process.env.SMTP_USER ?? 'hello@bespoxai.com'}>`

export async function sendVerificationEmail(to: string, companyName: string, token: string) {
  const url = `${process.env.NEXTAUTH_URL}/signup/verify?token=${token}`
  await transporter.sendMail({
    from:    FROM,
    to,
    subject: 'Verify your BespoxAI signup',
    html: `
      <div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#1a2a1e">
        <div style="background:#040E09;padding:24px 32px;border-radius:12px 12px 0 0">
          <span style="font-size:22px;font-weight:700;color:#F4EFE4">Bespox<span style="color:#C8952A">AI</span></span>
        </div>
        <div style="background:#f7f5f0;padding:32px;border-radius:0 0 12px 12px;border:1px solid #e8e4dc;border-top:none">
          <h2 style="margin:0 0 12px;font-size:20px">Thanks for signing up, ${companyName}!</h2>
          <p style="color:#3a4a3e;line-height:1.6">Please verify your email address to complete your signup request. Our team will review your application and be in touch shortly.</p>
          <a href="${url}" style="display:inline-block;margin:24px 0;background:#0A5C46;color:#fff;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px">
            Verify my email →
          </a>
          <p style="color:#8a9a8e;font-size:13px">Or copy this link:<br/><span style="color:#0A5C46">${url}</span></p>
          <p style="color:#8a9a8e;font-size:12px;margin-top:24px">This link expires in 48 hours. If you didn't sign up for BespoxAI, you can ignore this email.</p>
        </div>
      </div>
    `,
  })
}

export async function sendEmail({ to, subject, html, from }: { to: string; subject: string; html: string; from?: string }) {
  await transporter.sendMail({ from: from ?? FROM, to, subject, html })
}

export async function sendWelcomeEmail(to: string, companyName: string, tempPassword: string) {
  const loginUrl = `${process.env.NEXTAUTH_URL}/login`
  await transporter.sendMail({
    from:    FROM,
    to,
    subject: 'Welcome to BespoxAI — your account is ready',
    html: `
      <div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#1a2a1e">
        <div style="background:#040E09;padding:24px 32px;border-radius:12px 12px 0 0">
          <span style="font-size:22px;font-weight:700;color:#F4EFE4">Bespox<span style="color:#C8952A">AI</span></span>
        </div>
        <div style="background:#f7f5f0;padding:32px;border-radius:0 0 12px 12px;border:1px solid #e8e4dc;border-top:none">
          <h2 style="margin:0 0 12px;font-size:20px">Welcome to BespoxAI, ${companyName}!</h2>
          <p style="color:#3a4a3e;line-height:1.6">Your account has been set up. Your 7-day free trial starts today.</p>
          <div style="background:#fff;border:1px solid #e0dbd4;border-radius:8px;padding:20px;margin:24px 0">
            <p style="margin:0 0 8px;font-size:13px;color:#8a9a8e;font-weight:600;text-transform:uppercase;letter-spacing:0.05em">Your login details</p>
            <p style="margin:4px 0;font-size:14px"><strong>Email:</strong> ${to}</p>
            <p style="margin:4px 0;font-size:14px"><strong>Temporary password:</strong> <code style="background:#f0ede8;padding:2px 8px;border-radius:4px">${tempPassword}</code></p>
          </div>
          <a href="${loginUrl}" style="display:inline-block;background:#0A5C46;color:#fff;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px">
            Log in to BespoxAI →
          </a>
          <p style="color:#8a9a8e;font-size:13px;margin-top:24px">Please change your password after first login. If you have any questions, reply to this email.</p>
        </div>
      </div>
    `,
  })
}

export async function sendPasswordResetEmail(to: string, resetUrl: string) {
  await transporter.sendMail({
    from: FROM,
    to,
    subject: 'Reset your BespoxAI password',
    html: `
      <div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#1a2a1e">
        <div style="background:#040E09;padding:24px 32px;border-radius:12px 12px 0 0">
          <span style="font-size:22px;font-weight:700;color:#F4EFE4">Bespox<span style="color:#C8952A">AI</span></span>
        </div>
        <div style="background:#f7f5f0;padding:32px;border-radius:0 0 12px 12px;border:1px solid #e8e4dc;border-top:none">
          <h2 style="margin:0 0 12px;font-size:20px">Reset your password</h2>
          <p style="color:#3a4a3e;line-height:1.6">We received a request to reset the password for your BespoxAI account. Click the button below to choose a new password.</p>
          <a href="${resetUrl}" style="display:inline-block;margin:24px 0;background:#0A5C46;color:#fff;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px">
            Reset my password →
          </a>
          <p style="color:#8a9a8e;font-size:13px">Or copy this link:<br/><span style="color:#0A5C46">${resetUrl}</span></p>
          <p style="color:#8a9a8e;font-size:12px;margin-top:24px">This link expires in 1 hour. If you didn't request a password reset, you can safely ignore this email — your password won't change.</p>
        </div>
      </div>
    `,
  })
}
