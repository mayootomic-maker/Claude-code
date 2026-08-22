package app.margin.data.db

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase

@Database(
    entities = [
        GoalEntity::class,
        ListingEntity::class,
        EvaluationEntity::class,
        DecisionEntity::class,
        OwnedItemEntity::class,
        SaleDraftEntity::class,
    ],
    version = 1,
    exportSchema = true,
)
abstract class MarginDatabase : RoomDatabase() {
    abstract fun goals(): GoalDao
    abstract fun listings(): ListingDao
    abstract fun evaluations(): EvaluationDao
    abstract fun decisions(): DecisionDao
    abstract fun ownedItems(): OwnedItemDao
    abstract fun saleDrafts(): SaleDraftDao

    companion object {
        fun build(context: Context): MarginDatabase =
            Room.databaseBuilder(context, MarginDatabase::class.java, "margin.db")
                .fallbackToDestructiveMigration()
                .build()
    }
}
