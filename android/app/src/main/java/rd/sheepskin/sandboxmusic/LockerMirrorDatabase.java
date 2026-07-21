package rd.sheepskin.sandboxmusic;

import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;
import org.json.JSONArray;
import org.json.JSONObject;
import java.util.Locale;

/** Native metadata mirror for fast locker search on large libraries. */
public class LockerMirrorDatabase extends SQLiteOpenHelper {

    private static final String DB_NAME = "locker_mirror.db";
    private static final int DB_VERSION = 1;

    public LockerMirrorDatabase(Context context) {
        super(context, DB_NAME, null, DB_VERSION);
    }

    @Override
    public void onCreate(SQLiteDatabase db) {
        db.execSQL(
            "CREATE TABLE IF NOT EXISTS tracks (" +
                "id TEXT PRIMARY KEY NOT NULL," +
                "title TEXT NOT NULL," +
                "artist TEXT NOT NULL," +
                "album_name TEXT," +
                "genre TEXT," +
                "added_at INTEGER NOT NULL," +
                "search_text TEXT NOT NULL" +
            ")"
        );
        db.execSQL(
            "CREATE INDEX IF NOT EXISTS idx_tracks_search ON tracks(search_text)"
        );
    }

    @Override
    public void onUpgrade(SQLiteDatabase db, int oldVersion, int newVersion) {
        db.execSQL("DROP TABLE IF EXISTS tracks");
        onCreate(db);
    }

    public int upsertTracks(JSONArray tracks) {
        if (tracks == null) return 0;
        SQLiteDatabase db = getWritableDatabase();
        db.beginTransaction();
        int count = 0;
        try {
            for (int i = 0; i < tracks.length(); i++) {
                JSONObject row = tracks.optJSONObject(i);
                if (row == null) continue;
                String id = row.optString("id", "").trim();
                if (id.isEmpty()) continue;
                String title = row.optString("title", "");
                String artist = row.optString("artist", "");
                String album = row.optString("albumName", "");
                String genre = row.optString("genre", "");
                long addedAt = row.optLong("addedAt", 0L);
                String searchText = (title + " " + artist + " " + album + " " + genre)
                    .toLowerCase(Locale.ROOT);
                db.execSQL(
                    "INSERT OR REPLACE INTO tracks (id, title, artist, album_name, genre, added_at, search_text) " +
                        "VALUES (?, ?, ?, ?, ?, ?, ?)",
                    new Object[] { id, title, artist, album, genre, addedAt, searchText }
                );
                count += 1;
            }
            db.setTransactionSuccessful();
        } finally {
            db.endTransaction();
        }
        return count;
    }

    public JSONArray search(String query, int limit) {
        JSONArray hits = new JSONArray();
        String q = query == null ? "" : query.trim().toLowerCase(Locale.ROOT);
        if (q.length() < 2) return hits;
        int cap = Math.max(1, Math.min(limit, 200));
        SQLiteDatabase db = getReadableDatabase();
        String like = "%" + q.replace("%", "").replace("_", "") + "%";
        Cursor cursor = db.rawQuery(
            "SELECT id, title, artist, album_name FROM tracks WHERE search_text LIKE ? ORDER BY added_at DESC LIMIT ?",
            new String[] { like, String.valueOf(cap) }
        );
        try {
            while (cursor.moveToNext()) {
                JSONObject hit = new JSONObject();
                hit.put("id", cursor.getString(0));
                hit.put("title", cursor.getString(1));
                hit.put("artist", cursor.getString(2));
                hit.put("albumName", cursor.isNull(3) ? "" : cursor.getString(3));
                hits.put(hit);
            }
        } catch (Exception ignored) {
            /* return partial hits */
        } finally {
            cursor.close();
        }
        return hits;
    }

    public int getCount() {
        SQLiteDatabase db = getReadableDatabase();
        Cursor cursor = db.rawQuery("SELECT COUNT(*) FROM tracks", null);
        try {
            if (cursor.moveToFirst()) return cursor.getInt(0);
        } finally {
            cursor.close();
        }
        return 0;
    }

    public void clearAll() {
        SQLiteDatabase db = getWritableDatabase();
        db.execSQL("DELETE FROM tracks");
    }

    public JSONArray listAll(int limit) {
        JSONArray hits = new JSONArray();
        int cap = Math.max(1, Math.min(limit, 2000));
        SQLiteDatabase db = getReadableDatabase();
        Cursor cursor = db.rawQuery(
            "SELECT id, title, artist, album_name FROM tracks ORDER BY added_at DESC LIMIT ?",
            new String[] { String.valueOf(cap) }
        );
        try {
            while (cursor.moveToNext()) {
                JSONObject hit = new JSONObject();
                hit.put("id", cursor.getString(0));
                hit.put("title", cursor.getString(1));
                hit.put("artist", cursor.getString(2));
                hit.put("albumName", cursor.isNull(3) ? "" : cursor.getString(3));
                hits.put(hit);
            }
        } catch (Exception ignored) {
            /* partial */
        } finally {
            cursor.close();
        }
        return hits;
    }
}
