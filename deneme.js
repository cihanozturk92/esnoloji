// const { createClient } = require('@supabase/supabase-js');

// // Supabase Bilgilerin
// const SUPABASE_URL = 'https://njixhmpxbpssntazwdix.supabase.co';
// const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5qaXhobXB4YnBzc250YXp3ZGl4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODExMDY4NDcsImV4cCI6MjA5NjY4Mjg0N30.ZulWqfW5K0rk3VK7K96oa07xF7M4w8dQVOz_g1IOyBs';
// ; 

// const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// async function testEt() {
//   console.log("🔄 Supabase'e istek atılıyor, bekleyin...");
  
//   try {
//     const { data, error } = await supabase
//       .from('dukkanlar')
//       .select('*')
//       .limit(1);

//     if (error) {
//       console.log("❌ Supabase sunucusuna ulaşıldı ama veritabanı hata döndürdü:");
//       console.error(error);
//     } else {
//       console.log("✅ BAĞLANTI BAŞARILI! Tablodan gelen örnek veri:");
//       console.log(data);
//     }
//   } catch (err) {
//     console.log("💥 Ağda veya sistemde bağlantı tamamen koptu!");
//     console.error("Hata Detayı:", err);
//   }
// }

// testEt();