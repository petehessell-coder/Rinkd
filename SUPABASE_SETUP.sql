-- ============================================================
-- RINKD DATABASE SETUP
-- Run this entire file in Supabase SQL Editor
-- Project: Dashboard → SQL Editor → New Query → Paste → Run
-- ============================================================

-- PROFILES table
CREATE TABLE IF NOT EXISTS profiles (
  id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  name TEXT NOT NULL,
  handle TEXT UNIQUE NOT NULL,
  avatar_color TEXT DEFAULT '#2E5B8C',
  avatar_initials TEXT DEFAULT '??',
  bio TEXT DEFAULT '',
  position TEXT DEFAULT '',
  level TEXT DEFAULT '',
  home_rink TEXT DEFAULT '',
  points INTEGER DEFAULT 50,
  tier TEXT DEFAULT 'Mite',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- POSTS table
CREATE TABLE IF NOT EXISTS posts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  author_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  content TEXT NOT NULL,
  tag TEXT DEFAULT 'POST',
  tag_color TEXT DEFAULT '#2E5B8C',
  likes INTEGER DEFAULT 0,
  comment_count INTEGER DEFAULT 0,
  repost_count INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- LIKES table
CREATE TABLE IF NOT EXISTS likes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  post_id UUID REFERENCES posts(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(post_id, user_id)
);

-- COMMENTS table
CREATE TABLE IF NOT EXISTS comments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  post_id UUID REFERENCES posts(id) ON DELETE CASCADE NOT NULL,
  author_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE likes ENABLE ROW LEVEL SECURITY;
ALTER TABLE comments ENABLE ROW LEVEL SECURITY;

-- Profiles: anyone can read, only owner can update
CREATE POLICY "Profiles are viewable by everyone"
  ON profiles FOR SELECT USING (true);

CREATE POLICY "Users can insert their own profile"
  ON profiles FOR INSERT WITH CHECK (auth.uid() = id);

CREATE POLICY "Users can update their own profile"
  ON profiles FOR UPDATE USING (auth.uid() = id);

-- Posts: anyone can read, authenticated users can create
CREATE POLICY "Posts are viewable by everyone"
  ON posts FOR SELECT USING (true);

CREATE POLICY "Authenticated users can create posts"
  ON posts FOR INSERT WITH CHECK (auth.uid() = author_id);

CREATE POLICY "Users can delete their own posts"
  ON posts FOR DELETE USING (auth.uid() = author_id);

CREATE POLICY "System can update post counts"
  ON posts FOR UPDATE USING (true);

-- Likes: anyone can read, authenticated users can like
CREATE POLICY "Likes are viewable by everyone"
  ON likes FOR SELECT USING (true);

CREATE POLICY "Authenticated users can like"
  ON likes FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can unlike their own likes"
  ON likes FOR DELETE USING (auth.uid() = user_id);

-- Comments: anyone can read, authenticated users can comment
CREATE POLICY "Comments are viewable by everyone"
  ON comments FOR SELECT USING (true);

CREATE POLICY "Authenticated users can comment"
  ON comments FOR INSERT WITH CHECK (auth.uid() = author_id);

CREATE POLICY "Users can delete their own comments"
  ON comments FOR DELETE USING (auth.uid() = author_id);

-- ============================================================
-- HELPER FUNCTIONS (for atomic counter updates)
-- ============================================================

CREATE OR REPLACE FUNCTION increment_likes(post_id UUID)
RETURNS VOID AS $$
  UPDATE posts SET likes = likes + 1 WHERE id = post_id;
$$ LANGUAGE SQL SECURITY DEFINER;

CREATE OR REPLACE FUNCTION decrement_likes(post_id UUID)
RETURNS VOID AS $$
  UPDATE posts SET likes = GREATEST(likes - 1, 0) WHERE id = post_id;
$$ LANGUAGE SQL SECURITY DEFINER;

CREATE OR REPLACE FUNCTION increment_comments(post_id UUID)
RETURNS VOID AS $$
  UPDATE posts SET comment_count = comment_count + 1 WHERE id = post_id;
$$ LANGUAGE SQL SECURITY DEFINER;

CREATE OR REPLACE FUNCTION add_points(user_id UUID, pts INTEGER)
RETURNS VOID AS $$
DECLARE
  new_points INTEGER;
  new_tier TEXT;
BEGIN
  UPDATE profiles SET points = points + pts WHERE id = user_id
  RETURNING points INTO new_points;

  -- Update tier based on points
  new_tier := CASE
    WHEN new_points >= 15000 THEN 'Pro'
    WHEN new_points >= 8000  THEN 'Junior'
    WHEN new_points >= 4000  THEN 'Midget'
    WHEN new_points >= 1500  THEN 'Bantam'
    WHEN new_points >= 500   THEN 'Peewee'
    WHEN new_points >= 100   THEN 'Squirt'
    ELSE 'Mite'
  END;

  UPDATE profiles SET tier = new_tier WHERE id = user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- AUTO-UPDATE updated_at on profiles
-- ============================================================

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- DONE! Your Rinkd database is ready.
-- ============================================================
