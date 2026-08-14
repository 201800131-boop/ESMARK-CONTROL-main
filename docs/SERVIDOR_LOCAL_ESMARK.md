# Servidor local compartido para ESMARK Control

Esta configuracion mueve Supabase a una computadora central de la oficina. Todas las computadoras de ESMARK Control consultan la misma base local; no se crea una base diferente en cada equipo.

## Antes de comenzar

La computadora servidor debe:

- permanecer encendida durante la jornada;
- tener una direccion IP reservada en el router;
- tener como minimo 8 GB de RAM, 4 nucleos y 80 GB libres en SSD;
- usar Windows 10/11 con Docker Desktop y Git para Windows;
- estar conectada por cable de red cuando sea posible.

En esta computadora actual se detecto la IP `192.168.3.46`, pero debe reservarse en el router antes de usarla como direccion permanente.

Instala Docker Desktop si todavia no existe:

```powershell
winget install -e --id Docker.DockerDesktop
```

Reinicia Windows, abre Docker Desktop y espera que indique que el motor esta iniciado.

## 1. Preparar el servidor

Abre PowerShell como administrador en la raiz de este proyecto y ejecuta:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\supabase-local\1-Preparar-Servidor.ps1 `
  -PublicUrl "http://192.168.3.46:8000"
```

El script descarga una version fijada de la configuracion oficial de Supabase, genera claves aleatorias, copia las Edge Functions de ESMARK, limita el puerto de entrada a la red local e inicia los contenedores.

Los secretos quedan fuera del repositorio, en `%USERPROFILE%\ESMARK-Supabase\.env`. Nunca copies `SERVICE_ROLE_KEY`, `SUPABASE_SECRET_KEY` ni el archivo `.env` dentro de la aplicacion cliente.

Para que Trello siga funcionando, completa estos dos valores directamente en el servidor:

```text
%USERPROFILE%\ESMARK-Supabase\.env.functions
TRELLO_API_KEY=...
TRELLO_TOKEN=...
```

Despues reinicia solamente las funciones:

```powershell
cd $env:USERPROFILE\ESMARK-Supabase
docker compose -f docker-compose.yml -f docker-compose.esmark.yml up -d --force-recreate --no-deps functions
```

## 2. Copiar Supabase Cloud

Hazlo durante una ventana en la que nadie registre o modifique pedidos. En Supabase Dashboard copia la cadena de conexion directa desde **Database > Connect**. La contrasena es la contrasena de la base, no la del usuario de ESMARK.

Ejecuta:

```powershell
$env:ESMARK_CLOUD_DB_URL = Read-Host "Connection string de Supabase Cloud"
powershell -ExecutionPolicy Bypass -File .\scripts\supabase-local\2-Migrar-Desde-Nube.ps1
Remove-Item Env:\ESMARK_CLOUD_DB_URL
```

El proceso copia roles, estructura, politicas RLS, funciones SQL, usuarios de Auth y datos. No elimina nada de Supabase Cloud. Los usuarios conservan sus cuentas, pero deberan iniciar sesion nuevamente porque el servidor local emite tokens diferentes.

No ejecutes la migracion dos veces sobre el mismo servidor. El script crea una marca de finalizacion para impedir registros duplicados.

## 3. Construir ESMARK Control para la red local

Despues de que la migracion muestre los conteos de usuarios, pedidos y reportes:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\supabase-local\3-Configurar-App.ps1 -BuildInstaller
```

El instalador queda en `apps\windows\release`. Pruebalo primero en una sola computadora:

1. iniciar sesion con un administrador;
2. abrir historial y reportes;
3. crear un registro de prueba;
4. confirmar que aparece en una segunda computadora;
5. ejecutar un cierre y descargar su reporte.

Cuando todo pase, instala esa version en las demas computadoras. La configuracion local se guarda en `apps\windows\.env.local`, que Git ignora y que nunca debe contener una clave de servicio.

## 4. Respaldos diarios

Usa otro disco, una unidad USB o una carpeta de NAS. Guardar el respaldo en el mismo SSD del servidor no protege contra una falla del disco.

Prueba un respaldo manual:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\supabase-local\4-Respaldar.ps1 `
  -BackupDirectory "E:\ESMARK-Respaldos"
```

Si termina correctamente, programa el respaldo diario a las 11 p. m.:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\supabase-local\5-Programar-Respaldos.ps1 `
  -BackupDirectory "E:\ESMARK-Respaldos" `
  -Hour 23
```

Cada archivo `.dump` incluye un `.sha256` para comprobar integridad. Se conservan 30 dias por defecto.

Guarda tambien una copia protegida y fuera del servidor de `%USERPROFILE%\ESMARK-Supabase\.env`; contiene secretos y no debe compartirse por correo o chat.

## 5. Respaldos administrativos dentro de Supabase

Desde la version 1.0.41, cada vez que un administrador inicia la aplicacion se genera un JSON completo con las tablas de registros, reportes y cierres. La copia se guarda en el bucket privado `admin-backups` del Supabase local e incluye conteos y una huella SHA-256.

La primera vez se descarga tambien al equipo administrador. A partir de ahi, la aplicacion exige una nueva descarga cada 15 dias y revisa el vencimiento cada 15 minutos mientras permanezca abierta. El periodo solamente se marca como completado despues de que Supabase confirme el respaldo y se inicie la descarga.

En la computadora servidor se puede revisar en **Supabase Studio > Storage > admin-backups**. Solo los usuarios administradores autenticados tienen permiso para listar, crear, reemplazar o borrar objetos de ese bucket.

Este JSON facilita una recuperacion administrativa, pero vive en el mismo servidor. No reemplaza el respaldo diario `.dump` guardado en otro disco o NAS.

## Importante

- No borres Supabase Cloud el mismo dia del cambio. Conserva la copia sin nuevas escrituras hasta completar varios dias de verificacion.
- No abras los puertos 5432, 6543 u 8000 a Internet. Para acceso desde fuera de la oficina usa una VPN y HTTPS.
- El ZIP de Excel existente sigue siendo util para lectura administrativa, pero no reemplaza estos respaldos restaurables.
- Antes de actualizar los contenedores revisa el changelog de Supabase y crea un respaldo.

Documentacion oficial: [Supabase con Docker](https://supabase.com/docs/guides/self-hosting/docker), [restaurar Cloud en self-hosted](https://supabase.com/docs/guides/self-hosting/restore-from-platform), [Edge Functions self-hosted](https://supabase.com/docs/guides/self-hosting/self-hosted-functions).
