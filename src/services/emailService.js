const nodemailer = require('nodemailer');

// Create reusable transporter
const transporter = nodemailer.createTransport
({
  host: process.env.SMTP_HOST,
  port: process.env.SMTP_PORT,
  secure: false, // true for 465, false for other ports
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASSWORD
  }
});

const sendEmail = async (to, subject, text, html = null) => {
  try {
    const mailOptions = {
      from: `"Hospital Management System" <${process.env.SMTP_USER}>`,
      to: to,
      subject: subject,
      text: text,
      html: html || text.replace(/\n/g, '<br>')
    };

    const result = await transporter.sendMail(mailOptions);
    console.log('Email sent successfully:', result.messageId);
    return result;
  } catch (error) {
    console.error('Email sending failed:', error);
    throw error;
  }
};

const sendBulkEmail = async (recipients, subject, text, html = null) => {
  const promises = recipients.map(recipient => 
    sendEmail(recipient, subject, text, html)
  );
  
  try {
    const results = await Promise.allSettled(promises);
    return results;
  } catch (error) {
    console.error('Bulk email sending failed:', error);
    throw error;
  }
};

module.exports = {
  sendEmail,
  sendBulkEmail
};
