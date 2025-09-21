// const twilio = require('twilio');

// const client = twilio(
//   process.env.TWILIO_ACCOUNT_SID,
//   process.env.TWILIO_AUTH_TOKEN
// );

// const sendSMS = async (to, message) => {
//   try {
//     const result = await client.messages.create({
//       body: message,
//       from: process.env.TWILIO_PHONE_NUMBER,
//       to: to
//     });
    
//     console.log('SMS sent successfully:', result.sid);
//     return result;
//   } catch (error) {
//     console.error('SMS sending failed:', error);
//     throw error;
//   }
// };

// const sendBulkSMS = async (recipients, message) => {
//   const promises = recipients.map(recipient => 
//     sendSMS(recipient, message)
//   );
  
//   try {
//     const results = await Promise.allSettled(promises);
//     return results;
//   } catch (error) {
//     console.error('Bulk SMS sending failed:', error);
//     throw error;
//   }
// };

// module.exports = {
//   sendSMS,
//   sendBulkSMS
// };



// Stub SMS service - no actual sending, just log and resolve
module.exports = {
  sendSMS: async (to, message) => {
    console.log(`Skipping SMS send to ${to}: "${message}"`)
    return Promise.resolve()
  },
  sendBulkSMS: async (recipients, message) => {
    console.log(`Skipping bulk SMS send to ${recipients.length} recipients`)
    return Promise.resolve()
  }
}
