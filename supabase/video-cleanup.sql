-- Configurar en Vault: video_cleanup_url (URL de /member-video/cleanup)
-- y video_cleanup_secret (el mismo valor que VIDEO_CLEANUP_SECRET).
do $$
begin
  if (select count(*) from vault.decrypted_secrets where name in ('video_cleanup_url','video_cleanup_secret')) <> 2 then
    raise exception 'Faltan video_cleanup_url y video_cleanup_secret en Vault.';
  end if;
end;
$$;

select cron.schedule(
  'anastasi-video-cleanup',
  '17 * * * *',
  $job$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name='video_cleanup_url'),
      headers := jsonb_build_object('Content-Type','application/json','Authorization',
        'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name='video_cleanup_secret')),
      body := '{}'::jsonb,
      timeout_milliseconds := 30000
    );
  $job$
);
